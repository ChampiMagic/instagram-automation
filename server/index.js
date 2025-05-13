const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: 'http://localhost:3001' })); // Ajusta el origen según el puerto del frontend

const IG_APP_ID = process.env.IG_APP_ID;
const IG_APP_SECRET = process.env.IG_APP_SECRET;
const IG_REDIRECT_URI = process.env.IG_REDIRECT_URI;
const IG_VERIFY_TOKEN = process.env.IG_VERIFY_TOKEN;
let accessToken = null;
let instagramScopeID = null;
let pageId = null;
let pageAccessToken = null;

// Endpoint para procesar el token de acceso desde el frontend
app.post('/auth/token', async (req, res) => {
  const { accessToken: clientAccessToken } = req.body;
  if (!clientAccessToken) {
    return res.status(400).json({ error: 'Token de acceso no proporcionado' });
  }

  console.debug('clientAccessToken');

  try {
    // Obtener información del usuario con el token
    const userResponse = await axios.get('https://graph.facebook.com/v22.0/me', {
      params: {
        access_token: clientAccessToken,
        fields: 'id,name',
      },
    });

    console.debug('userResponse');

    // Obtener cuentas de Instagram Business asociadas
    const igResponse = await axios.get('https://graph.facebook.com/v22.0/me/accounts', {
      params: {
        access_token: clientAccessToken,
        fields: 'instagram_business_account{id,username},access_token',
      },
    });

    console.debug('igResponse', igResponse);

    const instagramAccount = igResponse.data.data.find(page => page.instagram_business_account);
    console.debug('instagramAccount', instagramAccount);
    if (!instagramAccount) {
      return res.status(400).json({ error: 'No se encontró una cuenta de Instagram Business vinculada', page: igResponse.data });
    }

    console.debug('1');
    // Almacenar información relevante
    accessToken = clientAccessToken;
    instagramScopeID = instagramAccount.instagram_business_account.id;
    pageId = instagramAccount.id;
    pageAccessToken = instagramAccount.access_token;


    console.debug('2');

    res.json({
      message: 'Cuenta conectada con éxito',
      instagramScopeID,
      username: instagramAccount.instagram_business_account.username,
    });


    console.debug('3');

  } catch (error) {
    console.error('Error en autenticación:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Error al conectar la cuenta' });
  }
});

// Verificación de Webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log("Verificando webhook");

  if (mode === 'subscribe' && token === IG_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Verificación fallida');
  }
});

// Procesamiento de Webhooks
app.post('/webhook', async (req, res) => {
  try {
    const data = req.body;

    console.debug('data', data);

    if (data.entry && data.entry[0]) {
      // Procesar comentarios
      if (data.entry[0].changes && data.entry[0].changes[0].value.text) {
        const comment = data.entry[0].changes[0].value.text.toLowerCase();
        const userId = data.entry[0].changes[0].value.from.id;

        if (comment.includes('quiero')) {
          await sendMessage(userId, 'Obten tu descuento desde aquí!');
        }
      }

      // Procesar mensajes directos
      if (data.entry[0].messaging && data.entry[0].messaging[0].message) {
        const message = data.entry[0].messaging[0].message.text.toLowerCase();
        const userId = data.entry[0].messaging[0].sender.id;

        if (message.includes('promo')) {
          await sendMessage(userId, 'Aquí está tu promoción!');
        }
      }
    }

    res.status(200).send('Evento procesado');
  } catch (error) {
    console.error('Error procesando webhook:', error.message);
    res.status(500).send('Error procesando evento');
  }
});

// Función para enviar mensajes
async function sendMessage(recipientId, message) {
  //if (!pageAccessToken || !pageId) {
  //  console.error('No se ha autenticado la cuenta o no se encontró la página de Facebook');
  //  return;
  //}

  try {
    await axios.post(
      'https://graph.facebook.com/v22.0/me/messages',
      {
        recipient: { id: recipientId },
        message: { text: message },
      },
      {
        params: {
          access_token: pageAccessToken,
        },
      }
    );
    console.log('Mensaje enviado:', message);
  } catch (error) {
    console.error('Error enviando mensaje:', error.response ? error.response.data : error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});