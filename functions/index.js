'use strict';

const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');

admin.initializeApp();
const db = admin.firestore();

const SITE_URL    = process.env.SITE_URL    || 'https://fast-checkout-hotel.web.app';
// 2nd-gen Cloud Run URL (shown after each deploy as "Function URL (mercadoPagoWebhook)")
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://mercadopagowebhook-5fa5s6ykhq-uc.a.run.app';

function getMPClient() {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) throw new Error('MP_ACCESS_TOKEN não configurado');
  return new MercadoPagoConfig({ accessToken, options: { timeout: 8000 } });
}

// ─── PIX ─────────────────────────────────────────────────────────────────────
exports.createPixPayment = functions.https.onCall(async (request) => {
  const { amount, roomId, guestName, roomNumber, rsv, items } = request.data;

  const amountNum = parseFloat(Number(amount).toFixed(2));
  if (!isFinite(amountNum) || amountNum <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Valor inválido');
  }
  if (!roomId) throw new functions.https.HttpsError('invalid-argument', 'roomId obrigatório');

  const client        = getMPClient();
  const paymentClient = new Payment(client);

  const response = await paymentClient.create({
    body: {
      transaction_amount: amountNum,
      description:        `Hotel Checkout — Quarto ${roomNumber} — ${guestName}`,
      payment_method_id:  'pix',
      payer:              { email: 'hospede@hotel.com.br' },
      notification_url:   WEBHOOK_URL,
      metadata:           { roomId, roomNumber, guestName },
      statement_descriptor: 'HOTEL CHECKOUT',
    },
  });

  const pixCode       = response.point_of_interaction?.transaction_data?.qr_code        || '';
  const pixCodeBase64 = response.point_of_interaction?.transaction_data?.qr_code_base64 || '';

  const paymentRef = await db.collection('payments').add({
    roomId,
    roomNumber,
    guestName,
    rsv:          rsv || '',
    amount:       amountNum,
    items:        items || [],
    method:       'pix',
    status:       'pending',
    mercadoPagoId: String(response.id),
    pixCode,
    pixCodeBase64,
    preferenceId: '',
    createdAt:    admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
  });

  return { paymentId: paymentRef.id, mercadoPagoId: String(response.id), pixCode, pixCodeBase64 };
});

// ─── Cartão / Google Pay (Checkout Pro) ──────────────────────────────────────
exports.createCardPreference = functions.https.onCall(async (request) => {
  const { amount, roomId, guestName, roomNumber, rsv, items } = request.data;

  const amountNum = parseFloat(Number(amount).toFixed(2));
  if (!isFinite(amountNum) || amountNum <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Valor inválido');
  }

  const client            = getMPClient();
  const preferenceClient  = new Preference(client);

  const preferenceItems = items && items.length > 0
    ? items.map(i => ({ title: i.name, quantity: 1, unit_price: Number(i.price), currency_id: 'BRL' }))
    : [{ title: `Hotel Checkout — Quarto ${roomNumber}`, quantity: 1, unit_price: amountNum, currency_id: 'BRL' }];

  const response = await preferenceClient.create({
    body: {
      items: preferenceItems,
      payer: { name: guestName },
      back_urls: {
        success: `${SITE_URL}?payment=success&roomId=${roomId}`,
        failure: `${SITE_URL}?payment=failure&roomId=${roomId}`,
        pending: `${SITE_URL}?payment=pending&roomId=${roomId}`,
      },
      auto_return: 'approved',
      // Explicitly allow credit/debit cards + Google Pay; exclude boleto and PIX
      payment_methods: {
        excluded_payment_types: [
          { id: 'ticket' },   // boleto
          { id: 'atm' },      // caixa eletrônico
        ],
        installments: 12,     // permite parcelamento em até 12x
      },
      notification_url:     WEBHOOK_URL,
      statement_descriptor: 'HOTEL CHECKOUT',
      metadata:             { roomId, roomNumber, guestName },
    },
  });

  const paymentRef = await db.collection('payments').add({
    roomId,
    roomNumber,
    guestName,
    rsv:          rsv || '',
    amount:       amountNum,
    items:        items || [],
    method:       'credit_card',
    status:       'pending',
    mercadoPagoId: '',
    pixCode:      '',
    pixCodeBase64: '',
    preferenceId:  response.id,
    initPoint:     response.init_point,
    sandboxInitPoint: response.sandbox_init_point,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    paymentId:       paymentRef.id,
    preferenceId:    response.id,
    initPoint:       response.init_point,
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

    const client        = getMPClient();
    const paymentClient = new Payment(client);
    const mpPayment     = await paymentClient.get({ id: data.id });

    if (mpPayment.status !== 'approved') {
      res.sendStatus(200);
      return;
    }

    const mercadoPagoId = String(mpPayment.id);
    const roomId        = mpPayment.metadata?.room_id || mpPayment.metadata?.roomId;

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

    if (!paymentDoc) { res.sendStatus(200); return; }

    const paymentData = paymentDoc.data();

    await paymentDoc.ref.update({
      status: 'approved',
      mercadoPagoId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection('rooms').doc(paymentData.roomId).update({
      balance:   0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection('notifications').add({
      type:    'payment',
      message: `💰 Pagamento confirmado — Quarto ${paymentData.roomNumber} — ${paymentData.guestName} — R$ ${Number(paymentData.amount).toFixed(2)}`,
      roomNumber: paymentData.roomNumber,
      roomId:     paymentData.roomId,
      amount:     paymentData.amount,
      method:     paymentData.method,
      read:       false,
      createdAt:  admin.firestore.FieldValue.serverTimestamp(),
    });

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(500);
  }
});

// ─── Guest checkout (sem auth, validado no servidor) ─────────────────────────
exports.guestCheckoutRoom = functions.https.onCall(async (request) => {
  const { roomId } = request.data;
  if (!roomId) throw new functions.https.HttpsError('invalid-argument', 'roomId obrigatório');

  const roomRef = db.collection('rooms').doc(roomId);
  const roomDoc = await roomRef.get();

  if (!roomDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Quarto não encontrado');
  }
  const roomData = roomDoc.data();
  if (roomData.status !== 'active') {
    throw new functions.https.HttpsError('failed-precondition', 'Check-out já realizado. Recarregue a página.');
  }
  if ((roomData.balance || 0) > 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Saldo pendente. Realize o pagamento primeiro.');
  }

  const now    = admin.firestore.FieldValue.serverTimestamp();
  const coData = {
    roomId, rsv: roomData.rsv || '', roomNumber: roomData.roomNumber,
    guestName: roomData.guestName, finalBalance: roomData.balance || 0,
    checkoutTime: now, checkedOutBy: 'guest', adminUid: null,
  };
  const batch = db.batch();
  batch.update(roomRef, { status: 'checked-out', checkoutTime: now, updatedAt: now });
  batch.set(db.collection('checkouts').doc(),       coData);
  batch.set(db.collection('checkoutHistory').doc(), coData);
  batch.set(db.collection('notifications').doc(), {
    type: 'checkout',
    message: `🏨 Check-out — Quarto ${roomData.roomNumber} — ${roomData.guestName}`,
    roomNumber: roomData.roomNumber, roomId,
    amount: null, method: null, read: false, createdAt: now,
  });
  await batch.commit();
  return { success: true };
});

// ─── Admin checkout ───────────────────────────────────────────────────────────
exports.adminCheckoutRoom = functions.https.onCall(async (request) => {
  if (!request.auth) throw new functions.https.HttpsError('unauthenticated', 'Login necessário');

  const adminDoc = await db.collection('admins').doc(request.auth.uid).get();
  if (!adminDoc.exists) throw new functions.https.HttpsError('permission-denied', 'Não é admin');

  const { roomId } = request.data;
  if (!roomId) throw new functions.https.HttpsError('invalid-argument', 'roomId obrigatório');

  const roomRef = db.collection('rooms').doc(roomId);
  const room    = await roomRef.get();
  if (!room.exists) throw new functions.https.HttpsError('not-found', 'Quarto não encontrado');

  const roomData = room.data();
  const now      = admin.firestore.FieldValue.serverTimestamp();
  const coData   = {
    roomId, rsv: roomData.rsv || '', roomNumber: roomData.roomNumber,
    guestName: roomData.guestName, finalBalance: roomData.balance || 0,
    checkoutTime: now, checkedOutBy: 'admin', adminUid: request.auth.uid,
  };
  const batch = db.batch();
  batch.update(roomRef, { status: 'checked-out', checkoutTime: now, updatedAt: now });
  batch.set(db.collection('checkouts').doc(),       coData);
  batch.set(db.collection('checkoutHistory').doc(), coData);
  batch.set(db.collection('notifications').doc(), {
    type: 'checkout',
    message: `🏨 Check-out (admin) — Quarto ${roomData.roomNumber} — ${roomData.guestName}`,
    roomNumber: roomData.roomNumber, roomId,
    amount: null, method: null, read: false, createdAt: now,
  });
  await batch.commit();
  return { success: true };
});
