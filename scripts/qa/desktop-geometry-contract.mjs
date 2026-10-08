import assert from 'node:assert/strict';

// Read-only DOM measurement, also usable by the local browser review harness.
export function readDesktopGeometry(root) {
  const box = element => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width };
  };
  const boxes = selector => [...root.querySelectorAll(selector)].map(box);
  return {
    viewport: root.ownerDocument.defaultView.innerWidth,
    documentWidth: root.scrollWidth,
    desktop: !!root.querySelector('[data-desktop-brand="true"], [data-desktop-checkout="true"]'),
    cartCards: boxes('.nv-cart-recommendation-grid > a > div'),
    productCards: boxes('.storefront-product-grid .storefront-product-card'),
    featuredCards: [...root.querySelectorAll('.nv-brand-flavor')].map(element => ({
      ...box(element),
      children: [...element.children].map(box),
    })),
    logos: boxes('.nv-brand-logo img'),
    fullWidthHeroes: boxes('.nv-brand-hero,.nv-local-hero,.nv-difference-hero,.nv-delivery-close,.nuvira-about-page > section:first-of-type picture img'),
    deliveryWindows: boxes('.nv-delivery-window'),
    homeDeliveryResults: [...root.querySelectorAll('.nv-brand-delivery-tool .nv-home-delivery-result')].map(element => ({ ...box(element), copy: box(element.firstElementChild), actions: box(element.querySelector('.nv-home-delivery-result-actions')) })),
    differenceSteps: [...root.querySelectorAll('.nv-difference-process li')].map(element => ({ ...box(element), detail: box(element.querySelector('p')) })),
    goodsPhotos: [...root.querySelectorAll('.nv-goods-photo img')].map(element => ({ ...box(element), fit: getComputedStyle(element).objectFit, loaded: element.complete && element.naturalWidth > 0 })),
    informationPages: boxes('.nv-information-page'),
    aboutPhotos: boxes('.nuvira-about-container > figure'),
    aboutImages: boxes('.nuvira-about-container > figure img'),
    programPhotos: boxes('.nv-brand-program-photo'),
    programBackground: root.querySelector('.nv-brand-program-band') ? getComputedStyle(root.querySelector('.nv-brand-program-band')).backgroundImage : null,
    programFeatureColumns: boxes('.nv-brand-program-panel > div'),
    programFeatureTabs: boxes('.nv-brand-program-tabs button'),
    programFeaturePortraits: [...root.querySelectorAll('.nv-program-blend > img')].map(element => ({ ...box(element), loaded: element.complete && element.naturalWidth > 0, naturalWidth: element.naturalWidth })),
    programBlendCaptions: [...root.querySelectorAll('.nv-program-blend figcaption')].map(element => ({ ...box(element), parent: box(element.parentElement), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })),
    informationEdges: [...root.querySelectorAll('.nuvira-about-page > section:not(:first-of-type) > .nuvira-about-container,section.nuvira-about-container,.nuvira-contact-layout,.nuvira-support-page,.nv-product-page > main,.nv-program-content')].map(element => {
      const rect = box(element);
      const style = getComputedStyle(element);
      return { left: rect.left + Number(style.paddingLeft.replace('px', '')), right: rect.right - Number(style.paddingRight.replace('px', '')) };
    }),
    titleWeights: [...root.querySelectorAll('.nv-brand-hero h1,.nv-brand-home h2,.nv-program-hero h1,.nv-product-copy h1,.nuvira-about-title,.nuvira-contact-intro h1,.nuvira-support-header h1')].map(element => Number(getComputedStyle(element).fontWeight)),
    programIncluded: boxes('.nv-program-included'),
    programHow: boxes('.nv-program-how'),
    programSchedule: boxes('.nv-program-schedule'),
    programPurchase: boxes('.nv-program-purchase'),
    programPairing: boxes('.nv-program-pairing'),
    programSteps: [...root.querySelectorAll('.nv-program-step')].map(element => ({ ...box(element), title: element.querySelector('h3') ? box(element.querySelector('h3')) : null, detail: box(element.querySelector('p')) })),
    programPortraits: [...root.querySelectorAll('.nv-program-portrait')].map(element => ({ ...box(element), loaded: element.complete && element.naturalWidth > 0, naturalWidth: element.naturalWidth })),
    programIntro: boxes('.nv-program-hero'),
    programKey: root.querySelector('.nv-program-page')?.getAttribute('data-program') || null,
    programAccent: root.querySelector('.nv-program-page') ? getComputedStyle(root.querySelector('.nv-program-page')).getPropertyValue('--nv-program-accent').trim() : null,
    footerColumns: boxes('.nv-brand-footer-inner > nav'),
    eventMargins: [...root.querySelectorAll('.nv-events-list > *')].map(element => getComputedStyle(element).marginTop),
    checkoutOrder: boxes('.nv-checkout-order'),
    checkoutSections: boxes('.nv-checkout-section'),
    checkoutSteps: boxes('.nv-checkout-steps'),
    clippedFields: [...root.querySelectorAll('input:not([type="hidden"]),select,textarea')]
      .filter(element => {
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement.getBoundingClientRect();
        return rect.width > 0 && (rect.left < parent.left - 1 || rect.right > parent.right + 1);
      }).map(element => element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.tagName),
  };
}

export function assertDesktopGeometry(snapshot) {
  const checks = [];
  assert.ok(snapshot.documentWidth <= snapshot.viewport + 1, 'Page must not overflow horizontally');
  checks.push('No horizontal page overflow');
  if (!snapshot.desktop) return checks;
  assert.ok(snapshot.viewport >= 1024, 'Desktop design must remain above its breakpoint');
  assert.equal(snapshot.clippedFields.length, 0, 'Fields must fit inside their parent');
  const near = (a, b, label) => assert.ok(Math.abs(a - b) <= 1, `${label}: ${a} vs ${b}`);
  for (const card of snapshot.cartCards.slice(1)) {
    near(card.top, snapshot.cartCards[0].top, 'Cart recommendation top edges');
    near(card.bottom, snapshot.cartCards[0].bottom, 'Cart recommendation bottom edges');
  }
  if (snapshot.cartCards.length > 1) checks.push('Cart recommendation top and bottom edges align');
  for (const card of snapshot.productCards || []) {
    assert.ok(card.width <= 350, `Shop cards stay compact: ${card.width}`);
  }
  for (const card of snapshot.featuredCards || []) {
    assert.ok(card.width <= 345, `Featured cards stay compact: ${card.width}`);
    for (const child of card.children) {
      assert.ok(child.top >= card.top - 1 && child.bottom <= card.bottom + 1, 'Featured card content stays inside its frame');
    }
    near(card.top, snapshot.featuredCards[0].top, 'Featured card top edges');
    near(card.bottom, snapshot.featuredCards[0].bottom, 'Featured card bottom edges');
  }
  for (const logo of snapshot.logos || []) assert.ok(logo.width <= 120, 'Menu logo remains restrained');
  for (const hero of snapshot.fullWidthHeroes || []) {
    near(hero.left, 0, 'Hero starts at viewport edge');
    near(hero.right, snapshot.viewport, 'Hero fills the viewport width');
  }
  for (const page of snapshot.informationPages || []) {
    near(page.left, 0, 'Information page starts at viewport edge');
    near(page.right, snapshot.viewport, 'Information page uses the full viewport');
  }
  for (const window of snapshot.deliveryWindows || []) {
    near(window.top, snapshot.deliveryWindows[0].top, 'Delivery windows align');
    near(window.bottom, snapshot.deliveryWindows[0].bottom, 'Delivery window heights match');
  }
  for (const result of snapshot.homeDeliveryResults || []) {
    near(result.copy.width, result.width, 'Delivery result copy uses its full column');
    assert.ok(result.actions.top >= result.copy.bottom, 'Delivery result actions follow the confirmation copy');
    assert.ok(result.actions.right <= result.right + 1, 'Delivery result actions stay inside the panel');
  }
  for (const step of snapshot.differenceSteps || []) {
    near(step.top, snapshot.differenceSteps[0].top, 'Freshness process steps align');
    near(step.detail.top, snapshot.differenceSteps[0].detail.top, 'Freshness process descriptions align');
  }
  for (const photo of snapshot.goodsPhotos || []) {
    assert.ok(photo.loaded, 'Goods image loads');
    assert.equal(photo.fit, 'contain', 'Goods photography shows the full item without stretching');
    assert.ok(photo.bottom - photo.top <= 480, 'Goods photography remains compact');
  }
  for (const photo of snapshot.programPhotos || []) assert.ok(photo.bottom - photo.top <= 321, 'Program photography stays compact');
  if (snapshot.programBackground) assert.match(snapshot.programBackground, /linear-gradient\(/, 'Programs use the rich gradient surface');
  for (let index = 1; index < (snapshot.programFeatureColumns || []).length; index++) {
    assert.ok(snapshot.programFeatureColumns[index - 1].right < snapshot.programFeatureColumns[index].left, 'Program feature columns stay separate');
  }
  for (const tab of snapshot.programFeatureTabs || []) {
    near(tab.top, snapshot.programFeatureTabs[0].top, 'Program tabs align');
    near(tab.bottom, snapshot.programFeatureTabs[0].bottom, 'Program tab heights match');
  }
  for (const portrait of snapshot.programFeaturePortraits || []) {
    assert.ok(portrait.loaded && portrait.naturalWidth >= portrait.width * 2, 'Program selector portrait loads sharply');
  }
  for (const caption of snapshot.programBlendCaptions || []) {
    assert.ok(caption.left >= caption.parent.left - 1 && caption.right <= caption.parent.right + 1 && caption.bottom <= caption.parent.bottom + 1, 'Bottle captions remain inside their product image');
    assert.ok(caption.scrollWidth <= caption.clientWidth + 1, 'Bottle caption text must not overflow');
  }
  const contentEdge = Math.max(48, (snapshot.viewport - 1440) / 2);
  for (const edges of snapshot.informationEdges || []) {
    near(edges.left, contentEdge, 'Information left edge matches the shared content width');
    near(edges.right, snapshot.viewport - contentEdge, 'Information right edge matches the shared content width');
  }
  for (const weight of snapshot.titleWeights || []) assert.equal(weight, 650, 'Display titles use the stronger serif weight');
  if (snapshot.programIncluded?.length) {
    const included = snapshot.programIncluded[0];
    const pairing = snapshot.programPairing[0];
    const purchase = snapshot.programPurchase[0];
    assert.ok(pairing && purchase, 'Program purchase controls remain present');
    near(included.top, purchase.top, 'Program summary starts alongside the choices');
    assert.ok(included.right < pairing.left, 'Program choices and purchase column do not overlap');
    near(pairing.top, purchase.top, 'Program purchase comes before optional shots');
    checks.push('Program choices, total and optional shots stay in separate aligned columns');
  }
  if (snapshot.programHow?.length && snapshot.programSchedule?.length) {
    assert.ok(snapshot.programIncluded[0].bottom <= snapshot.programHow[0].top, 'How it works follows the included bottle mix');
    assert.ok(snapshot.programHow[0].bottom <= snapshot.programSchedule[0].top, 'How it works appears before the daily schedule');
    checks.push('How it works follows the bottle mix and precedes the daily schedule');
  }
  for (const step of snapshot.programSteps || []) {
    near(step.top, snapshot.programSteps[0].top, 'How it works steps align');
    near(step.title.top, snapshot.programSteps[0].title.top, 'How it works titles align');
    near(step.detail.top, snapshot.programSteps[0].detail.top, 'How it works details align');
  }
  for (const portrait of snapshot.programPortraits || []) {
    assert.ok(portrait.loaded, 'Program portrait loads');
    assert.ok(portrait.width <= 240 && portrait.naturalWidth >= portrait.width * 2, 'Program portrait stays crisp at double pixel density');
  }
  for (const intro of snapshot.programIntro || []) assert.ok(intro.bottom - intro.top <= 210, 'Program introduction stays compact, without an oversized photo banner');
  if (snapshot.programKey === 'hydration') assert.equal(snapshot.programAccent, '#9a2943', 'Hydration uses its red identity');
  for (const photo of snapshot.aboutPhotos || []) {
    assert.ok(photo.bottom - photo.top <= 420, 'About photo row stays compact');
    near(photo.top, snapshot.aboutPhotos[0].top, 'About photo top edges');
    near(photo.bottom, snapshot.aboutPhotos[0].bottom, 'About photo bottom edges');
  }
  for (const photo of snapshot.aboutImages || []) assert.ok(photo.bottom - photo.top <= 350, 'About images do not expand to intrinsic height');
  for (const column of (snapshot.footerColumns || []).slice(1)) near(column.top, snapshot.footerColumns[0].top, 'Footer navigation top edges');
  if (snapshot.productCards?.length || snapshot.featuredCards?.length) checks.push('Product sizing and featured card containment pass');
  assert.ok(snapshot.eventMargins.every(margin => margin === '0px'), 'Event grid must not retain mobile stacking margins');
  if (snapshot.eventMargins.length) checks.push('Event grid uses gap, not stacked margins');
  if (snapshot.checkoutSections.length) {
    const first = snapshot.checkoutSections[0];
    for (const section of snapshot.checkoutSections.slice(1)) {
      near(section.left, first.left, 'Checkout card left edges');
      near(section.right, first.right, 'Checkout card right edges');
    }
    const order = snapshot.checkoutOrder[0];
    assert.ok(order, 'Checkout order summary must exist');
    // The summary may stick after scrolling, so test non-overlap, not scroll-relative top equality.
    assert.ok(first.right <= order.left, 'Checkout columns must not overlap');
    checks.push('Checkout step edges align and summary column does not overlap');
  }
  return checks;
}
