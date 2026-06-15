-- Método de pagamento confirmado da subscription (id do PaymentMethod no
-- Stripe). NULL = sem cartão. Um trial criado pelo PaymentSheet nasce sem
-- cartão; só concede premium quando o SetupIntent conclui e grava o id aqui.
ALTER TABLE "subscriptions" ADD COLUMN "defaultPaymentMethodId" TEXT;
