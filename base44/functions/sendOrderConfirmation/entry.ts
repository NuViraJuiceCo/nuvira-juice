Deno.serve(async () => {
  return Response.json({
    deprecated: true,
    mutated: false,
    replacement: 'Stripe webhook -> sendOrderReceivedNotification + sendOrderSms',
    message: 'sendOrderConfirmation is disabled. Order confirmations are owned by the Customer App Stripe webhook confirmation path.',
  }, { status: 410 });
});
