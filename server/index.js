const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const IG_APP_ID = process.env.IG_APP_ID;
const IG_APP_SECRET = process.env.IG_APP_SECRET;
const IG_REDIRECT_URI = process.env.IG_REDIRECT_URI;
const IG_VERIFY_TOKEN = process.env.IG_VERIFY_TOKEN;
let accessToken = null;
let instagramScopeID = null;

// Generar URL de autenticación
app.get('/auth', (req, res) => {
  const scope = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments';
  const url = `https://www.instagram.com/oauth/authorize?client_id=${IG_APP_ID}&redirect_uri=${IG_REDIRECT_URI}&response_type=code&scope=${scope}`;
  res.redirect(url);
});

// Callback de autenticación
app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  try {
    // Obtener token de corta duración
    const tokenResponse = await axios.post('https://api.instagram.com/oauth/access_token', {
      client_id: IG_APP_ID,
      client_secret: IG_APP_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: IG_REDIRECT_URI,
    }, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });

    const shortLivedToken = tokenResponse.data.access_token;
    const userId = tokenResponse.data.user_id;

    // Obtener token de larga duración
    const longLivedResponse = await axios.get('https://graph.instagram.com/access_token', {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: IG_APP_SECRET,
        access_token: shortLivedToken,
      }
    });

    accessToken = longLivedResponse.data.access_token;

    // Obtener instagramScopeID
    const userInfo = await axios.get(`https://graph.instagram.com/v22.0/${userId}`, {
      params: {
        access_token: accessToken,
        fields: 'id,username',
      }
    });

    instagramScopeID = userInfo.data.id;

    res.send('Cuenta conectada con éxito. Puedes cerrar esta ventana.');
  } catch (error) {
    console.error('Error en autenticación:', error.response ? error.response.data : error.message);
    res.status(500).send('Error al conectar la cuenta');
  }
});

// Verificación de Webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

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
  if (!accessToken || !instagramScopeID) {
    console.error('No se ha autenticado la cuenta');
    return;
  }

  try {
    await axios.post(
      `https://graph.instagram.com/v22.0/${instagramScopeID}/messages`,
      {
        recipient: { id: recipientId },
        message: { text: message },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        }
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