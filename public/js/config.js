// ============================================================
//  CONFIGURAÇÃO — substitua com os dados do seu projeto
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyDU3pu6ClM80VSt9IW88aHCgsq00YLNvj4",
  authDomain: "fast-checkout-hotel.firebaseapp.com",
  projectId: "fast-checkout-hotel",
  storageBucket: "fast-checkout-hotel.firebasestorage.app",
  messagingSenderId: "808249013859",
  appId: "1:808249013859:web:3c252ec8fa2563d35eaa56",
  measurementId: "G-HL5P37EY2S"
};

// Chave pública do Mercado Pago (começa com APP_USR-...)
// Para testes, use a chave de SANDBOX
const MERCADO_PAGO_PUBLIC_KEY = "APP_USR-4b23c2e3-e4eb-4304-bcd9-279ae99fe858";

// URL das suas Cloud Functions (preenchida após o deploy)
// Exemplo: "https://us-central1-fast-checkout-hotel.cloudfunctions.net"
const FUNCTIONS_BASE_URL = "https://us-central1-fast-checkout-hotel.cloudfunctions.net";
