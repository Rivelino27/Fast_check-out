mudar menu adm url E:\DOCS\LINGUAGENS\sites html e css\Fast_check-out\public\js\app.js
menu adm https://fast-checkout-hotel.web.app//admin-login-r27

Run npm install inside functions/ (needed after firebase-functions was bumped to ^6.0.0):


cd functions
npm install
Deploy everything:

Fill in the Mercado Pago credentials (if not done yet):


firebase functions:config:set mercadopago.access_token="APP_USR-..." mercadopago.public_key="APP_USR-..." app.site_url="https://fast-checkout-hotel.web.app"
firebase deploy --only functions

firebase deploy

Como criar o usuário Admin (causa do erro)
O login funcionou, mas falta criar o documento no Firestore. Siga estes passos:

1. Firebase Console → Authentication → aba Usuários → clique em "Adicionar usuário"

E-mail: seu email de admin
Senha: defina uma senha forte
Clique Adicionar usuário
2. Copie o UID do usuário criado (coluna "User UID", tipo abc123xyz...)

3. Firebase Console → Firestore Database → clique "Iniciar coleção"

ID da coleção: admins
ID do documento: cole o UID copiado (não deixe auto-gerar)
Adicione o campo: email → string → seu@email.com
Clique Salvar

