'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');

admin.initializeApp();
const db = admin.firestore();

function getMPClient() {
  const accessToken = functions.config().mercadopago.access_token;
  return new MercadoPagoConfig({ accessToken, options: { timeout: 5000 } });
}

function getWebhookUrl(req) {
  return `https://${req ? req.hostname : 'us-central1-SEU-PROJETO.cloudfunctions.net'}/mercadoPagoWebhook`;
}

// ─── Criar pagamento PIX ──────────────────────────────────────────────────────
exports.createPixPayment = functions.https.onCall(async (data, context) => {
  const { amount, roomId, guestName, roomNumber, items } = data;

  if (!amount || amount <= 0) throw new functions.https.HttpsError('invalid-argument', 'Valor inválido');
  if (!roomId) throw new functions.https.HttpsError('invalid-argument', 'roomId obrigatório');

  const client = getMPClient();
  const paymentClient = new Payment(client);

  const siteUrl = functions.config().app?.site_url || 'https://fast-checkout-hotel.web.app';

  const response = await paymentClient.create({
    body: {
      transaction_amount: Number(amount.toFixed(2)),
      description: `Hotel Checkout — Quarto ${roomNumber} — ${guestName}`,
      payment_method_id: 'pix',
      payer: { email: 'hospede@hotel.com.br' },
      notification_url: `${siteUrl.replace('web.app', 'cloudfunctions.net').replace('https://', 'https://us-central1-')}/mercadoPagoWebhook`,
      metadata: { roomId, roomNumber, guestName },
      statement_descriptor: 'HOTEL CHECKOUT',
    },
  });

  const pixCode = response.point_of_interaction?.transaction_data?.qr_code || '';
  const pixBase64 = response.point_of_interaction?.transaction_data?.qr_code_base64 || '';

  const paymentRef = await db.collection('payments').add({
    roomId,
    roomNumber,
    guestName,
    amount,
    items: items || [],
    method: 'pix',
    status: 'pending',
    mercadoPagoId: String(response.id),
    pixCode,
    pixCodeBase64: pixBase64,
    preferenceId: '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    paymentId: paymentRef.id,
    mercadoPagoId: String(response.id),
    pixCode,
    pixCodeBase64: pixBase64,
  };
});

// ─── Criar preferência para cartão / Google Pay (Checkout Pro) ───────────────
exports.createCardPreference = functions.https.onCall(async (data, context) => {
  const { amount, roomId, guestName, roomNumber, items } = data;

  if (!amount || amount <= 0) throw new functions.https.HttpsError('invalid-argument', 'Valor inválido');

  const client = getMPClient();
  const preferenceClient = new Preference(client);

  const siteUrl = functions.config().app?.site_url || 'https://fast-checkout-hotel.web.app';
  const webhookUrl = `${siteUrl.replace('web.app', 'cloudfunctions.net').replace('https://', 'https://us-central1-')}/mercadoPagoWebhook`;

  const preferenceItems = items && items.length > 0
    ? items.map(i => ({ title: i.name, quantity: 1, unit_price: Number(i.price), currency_id: 'BRL' }))
    : [{ title: `Hotel Checkout — Quarto ${roomNumber}`, quantity: 1, unit_price: Number(amount.toFixed(2)), currency_id: 'BRL' }];

  const response = await preferenceClient.create({
    body: {
      items: preferenceItems,
      payer: { name: guestName },
      back_urls: {
        success: `${siteUrl}?payment=success&roomId=${roomId}`,
        failure: `${siteUrl}?payment=failure&roomId=${roomId}`,
        pending: `${siteUrl}?payment=pending&roomId=${roomId}`,
      },
      auto_return: 'approved',
      notification_url: webhookUrl,
      statement_descriptor: 'HOTEL CHECKOUT',
      metadata: { roomId, roomNumber, guestName },
    },
  });

  const paymentRef = await db.collection('payments').add({
    roomId,
    roomNumber,
    guestName,
    amount,
    items: items || [],
    method: 'credit_card',
    status: 'pending',
    mercadoPagoId: '',
    pixCode: '',
    pixCodeBase64: '',
    preferenceId: response.id,
    initPoint: response.init_point,
    sandboxInitPoint: response.sandbox_init_point,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    paymentId: paymentRef.id,
    preferenceId: response.id,
    initPoint: response.init_point,
    sandboxInitPoint: response.sandbox_init_point,
  };
});

// ─── Webhook Mercado Pago ─────────────────────────────────────────────────────
exports.mercadoPagoWebhook = functions.https.onRequest(async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type !== 'payment' || !data?.id) {
      res.sendStatus(200);
      return;
    }

    const client = getMPClient();
    const paymentClient = new Payment(client);
    const mpPayment = await paymentClient.get({ id: data.id });

    if (mpPayment.status !== 'approved') {
      res.sendStatus(200);
      return;
    }

    const mercadoPagoId = String(mpPayment.id);
    const roomId = mpPayment.metadata?.room_id || mpPayment.metadata?.roomId;

    // Buscar pagamento no Firestore pelo mercadoPagoId ou preferenceId
    let paymentDoc = null;

    const byMPId = await db.collection('payments')
      .where('mercadoPagoId', '==', mercadoPagoId).limit(1).get();

    if (!byMPId.empty) {
      paymentDoc = byMPId.docs[0];
    } else if (roomId) {
      const byRoom = await db.collection('payments')
        .where('roomId', '==', roomId)
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'desc').limit(1).get();
      if (!byRoom.empty) paymentDoc = byRoom.docs[0];
    }

    if (!paymentDoc) {
      res.sendStatus(200);
      return;
    }

    const paymentData = paymentDoc.data();

    // Atualiza pagamento como aprovado
    await paymentDoc.ref.update({
      status: 'approved',
      mercadoPagoId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Zera o saldo do quarto
    const roomRef = db.collection('rooms').doc(paymentData.roomId);
    await roomRef.update({
      balance: 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Notifica os admins
    await db.collection('notifications').add({
      type: 'payment',
      message: `✅ Pagamento confirmado — Quarto ${paymentData.roomNumber} — ${paymentData.guestName} — R$ ${Number(paymentData.amount).toFixed(2)}`,
      roomNumber: paymentData.roomNumber,
      roomId: paymentData.roomId,
      amount: paymentData.amount,
      method: paymentData.method,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(500);
  }
});

// ─── Fazer checkout (pode ser chamado pelo admin) ─────────────────────────────
exports.adminCheckoutRoom = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login necessário');

  const adminDoc = await db.collection('admins').doc(context.auth.uid).get();
  if (!adminDoc.exists) throw new functions.https.HttpsError('permission-denied', 'Não é admin');

  const { roomId } = data;
  if (!roomId) throw new functions.https.HttpsError('invalid-argument', 'roomId obrigatório');

  const roomRef = db.collection('rooms').doc(roomId);
  const room = await roomRef.get();
  if (!room.exists) throw new functions.https.HttpsError('not-found', 'Quarto não encontrado');

  const roomData = room.data();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const batch = db.batch();

  // Atualiza status do quarto
  batch.update(roomRef, { status: 'checked-out', checkoutTime: now, updatedAt: now });

  // Cria documento de checkout
  const checkoutRef = db.collection('checkouts').doc();
  batch.set(checkoutRef, {
    roomId,
    rsv: roomData.rsv || '',
    roomNumber: roomData.roomNumber,
    guestName: roomData.guestName,
    finalBalance: roomData.balance || 0,
    checkoutTime: now,
    checkedOutBy: 'admin',
    adminUid: context.auth.uid,
  });

  // Notificação
  const notifRef = db.collection('notifications').doc();
  batch.set(notifRef, {
    type: 'checkout',
    message: `🏨 Check-out realizado (admin) — Quarto ${roomData.roomNumber} — ${roomData.guestName}`,
    roomNumber: roomData.roomNumber,
    roomId,
    amount: null,
    method: null,
    read: false,
    createdAt: now,
  });

  await batch.commit();
  return { success: true };
});
