import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { SITE_URL } from '@/lib/seo-slugs';

const GENERATED_FAQ_PATTERNS = [
  /"@type"\s*:\s*"FAQPage"/i,
  /manages 5 data types/i,
  /Helps you organize, track, and share your work/i,
];

const ADMIN_META_DESCRIPTION = 'Protected NuVira operations workspace.';

function removeGeneratedFaqStructuredData() {
  document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
    const content = script.textContent || '';
    if (GENERATED_FAQ_PATTERNS.every(pattern => pattern.test(content))) {
      script.remove();
    }
  });
}

function normalizeCanonicalUrl(value = '') {
  try {
    const url = new URL(value, SITE_URL);
    const host = url.host.replace(/^www\./, '');
    const path = url.pathname.length > 1 ? url.pathname.toLowerCase().replace(/\/+$/, '') : '/';
    return `${url.protocol}//${host}${path}`;
  } catch {
    return value;
  }
}

function expectedCanonicalForPath(pathname = '/') {
  const path = pathname.length > 1 ? pathname.toLowerCase().replace(/\/+$/, '') : '/';
  return `${SITE_URL}${path}`;
}

function removeStaleUrlTags(pathname) {
  const expected = normalizeCanonicalUrl(expectedCanonicalForPath(pathname));

  const canonicalLinks = Array.from(document.querySelectorAll('link[rel="canonical"]'));
  const matchingCanonicalLinks = canonicalLinks.filter(link => normalizeCanonicalUrl(link.href) === expected);
  if (matchingCanonicalLinks.length > 0) {
    canonicalLinks
      .filter(link => normalizeCanonicalUrl(link.href) !== expected)
      .forEach(link => link.remove());
    matchingCanonicalLinks.slice(0, -1).forEach(link => link.remove());
  }

  const ogUrlTags = Array.from(document.querySelectorAll('meta[property="og:url"]'));
  const matchingOgTags = ogUrlTags.filter(tag => normalizeCanonicalUrl(tag.content) === expected);
  if (matchingOgTags.length > 0) {
    ogUrlTags
      .filter(tag => normalizeCanonicalUrl(tag.content) !== expected)
      .forEach(tag => tag.remove());
    matchingOgTags.slice(0, -1).forEach(tag => tag.remove());
  }
}

function upsertMeta(selector, createAttrs, content) {
  const existing = Array.from(document.querySelectorAll(selector));
  if (existing.length > 0) {
    existing.forEach(tag => tag.setAttribute('content', content));
    existing.slice(0, -1).forEach(tag => tag.remove());
    return;
  }

  const meta = document.createElement('meta');
  Object.entries(createAttrs).forEach(([key, value]) => meta.setAttribute(key, value));
  meta.setAttribute('content', content);
  document.head.appendChild(meta);
}

function keepLastHeadTag(selector) {
  const tags = Array.from(document.querySelectorAll(selector));
  if (tags.length <= 1) return;

  const preferred = [...tags].reverse().find(tag => tag.getAttribute('data-rh') === 'true') || tags[tags.length - 1];
  tags.filter(tag => tag !== preferred).forEach(tag => tag.remove());
}

function dedupeRouteHeadTags() {
  [
    'meta[name="description"]',
    'meta[name="keywords"]',
    'meta[name="robots"]',
    'meta[property="og:type"]',
    'meta[property="og:site_name"]',
    'meta[property="og:title"]',
    'meta[property="og:description"]',
    'meta[property="og:image"]',
    'meta[property="og:image:width"]',
    'meta[property="og:image:height"]',
    'meta[property="og:image:alt"]',
    'meta[property="og:locale"]',
    'meta[name="twitter:card"]',
    'meta[name="twitter:title"]',
    'meta[name="twitter:description"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:alt"]',
  ].forEach(keepLastHeadTag);
}

function removeAdminGeneratedStructuredData() {
  document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
    const content = script.textContent || '';
    const isAdminBreadcrumb = /"@type"\s*:\s*"BreadcrumbList"/i.test(content) && /\/admin(?:\/|")/i.test(content);
    const isGeneratedFaq = /"@type"\s*:\s*"FAQPage"/i.test(content);
    if (isAdminBreadcrumb || isGeneratedFaq) {
      script.remove();
    }
  });
}

function sanitizeAdminHead(pathname) {
  if (!pathname.toLowerCase().startsWith('/admin')) return;

  document.title = 'Admin Operations | NuVira Juice Co.';
  upsertMeta('meta[name="robots"]', { name: 'robots' }, 'noindex, nofollow');
  upsertMeta('meta[name="description"]', { name: 'description' }, ADMIN_META_DESCRIPTION);
  upsertMeta('meta[property="og:title"]', { property: 'og:title' }, 'Admin Operations | NuVira Juice Co.');
  upsertMeta('meta[property="og:description"]', { property: 'og:description' }, ADMIN_META_DESCRIPTION);
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, 'Admin Operations | NuVira Juice Co.');
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, ADMIN_META_DESCRIPTION);

  document.querySelectorAll('meta[name="keywords"]').forEach(tag => tag.remove());
  removeAdminGeneratedStructuredData();
}

export default function SeoHeadSanitizer() {
  const location = useLocation();

  useEffect(() => {
    removeGeneratedFaqStructuredData();
    removeStaleUrlTags(location.pathname);
    sanitizeAdminHead(location.pathname);
    dedupeRouteHeadTags();
    const timeout = window.setTimeout(() => {
      removeGeneratedFaqStructuredData();
      removeStaleUrlTags(window.location.pathname);
      sanitizeAdminHead(window.location.pathname);
      dedupeRouteHeadTags();
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [location.pathname]);

  return null;
}
