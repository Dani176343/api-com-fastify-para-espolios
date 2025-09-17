
// Importando o módulo Fastify
require('dotenv').config({ path: '.env.dev' });
const fastify = require('fastify')();
const { MongoClient, ObjectId } = require('mongodb');
const multipart = require('@fastify/multipart');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');

// Configurações do MongoDB
const mongoUrl = process.env.MONGO_URL;
const dbName = process.env.DB_NAME;

// Configurações da API Externa
const externalApiUrl = process.env.EXTERNAL_API_URL;
const externalApiUsername = process.env.EXTERNAL_API_USERNAME;
const externalApiPassword = process.env.EXTERNAL_API_PASSWORD;

let db;
let currentToken;

// Registrar o plugin multipart
fastify.register(multipart, {
  limits: {
    fileSize: 52428800, // 50 MB
  },
});

// Conectar ao MongoDB
fastify.addHook('onReady', async () => {
  try {
    const client = new MongoClient(mongoUrl);
    await client.connect();
    db = client.db(dbName);
    console.log('Conectado ao MongoDB');
  } catch (error) {
    console.error('Erro ao conectar ao MongoDB:', error);
    process.exit(1);
  }
});

// Função para buscar o token de autenticação da API externa
async function fetchTokenFromServer() {
    const jsonFile = {
        username: externalApiUsername,
        password: externalApiPassword
    }
    const result = await axios.post(`${externalApiUrl}/RestServices/api/v1/auth/login`, jsonFile)
    if (result.status === 200) {
        console.log('Token obtido com sucesso!');
        currentToken = result.data.payload.token;
        return currentToken;
    }
    throw new Error('Não foi possível obter o token de autenticação.');
}

// Função para enviar a imagem para a API externa
async function uploadImageViaExternalAPI(fileBuffer, fileName) {
    if (!currentToken) {
        await fetchTokenFromServer();
    }

    const form = new FormData();
    form.append('file', fileBuffer, { filename: fileName });
    form.append('publicFile', 'true');
    form.append('folder', 'associacoes-abt-docs/nomeassociacaoxpto/espolio');

    try {
        const result = await axios.post(`${externalApiUrl}/RestServices/api/v2/repositorio/files`, form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${currentToken}`
            }
        });

        if (result.status === 200 && result.data.payload && result.data.payload.url) {
            return result.data.payload.url;
        }
    } catch (error) {
        if (error.response && error.response.status === 401) { // Unauthorized
            console.log('Token expirado ou inválido. Obtendo um novo token...');
            await fetchTokenFromServer();
            // Tenta novamente com o novo token
            const retryResult = await axios.post(`${externalApiUrl}/RestServices/api/v2/files`, form, {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${currentToken}`
                }
            });
            if (retryResult.status === 200 && retryResult.data.payload && retryResult.data.payload.url) {
                return retryResult.data.payload.url;
            }
        }
        console.error('Erro ao enviar imagem para API externa:', error.response ? error.response.data : error.message);
        throw new Error('Falha ao enviar imagem para o serviço externo.');
    }
}


// Rota para obter todos os itens de uma coleção
fastify.get('/espolios/:collectionName', async (request, reply) => {
  console.log(`GET /espolios/${request.params.collectionName}`);
  try {
    const { collectionName } = request.params;
    const collection = db.collection(collectionName);
    const items = await collection.find().toArray();
    return items;
  } catch (error) {
    console.error('Erro ao buscar itens:', error);
    reply.status(500).send({ error: 'Erro ao buscar itens' });
  }
});

// Rota para obter um item por ID de uma coleção
fastify.get('/espolios/:collectionName/:id', async (request, reply) => {
  console.log(`GET /espolios/${request.params.collectionName}/${request.params.id}`);
  try {
    const { collectionName, id } = request.params;
    const collection = db.collection(collectionName);
    const item = await collection.findOne({ _id: new ObjectId(id) });
    if (!item) {
      return reply.status(404).send({ error: 'Item não encontrado' });
    }
    return item;
  } catch (error) {
    console.error('Erro ao buscar o item:', error);
    reply.status(500).send({ error: 'Erro ao buscar o item' });
  }
});

// Rota para adicionar um novo item em uma coleção
fastify.post('/espolios/:collectionName', async (request, reply) => {
  console.log(`POST /espolios/${request.params.collectionName}`);
  try {
    const { collectionName } = request.params;
    const collection = db.collection(collectionName);
    const parts = request.parts();
    const newItem = {};
    const arrayFields = ['outraNumeracao', 'nucleo', 'categoria', 'materiais', 'tecnicas', 'lugares', 'intervencoes', 'objetosAssociados', 'bibliografia'];

    function setNestedProperty(obj, path, value, isArrayField) {
      const keys = path.split('.');
      let current = obj;
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key] || typeof current[key] !== 'object') {
          current[key] = {};
        }
        current = current[key];
      }
      const lastKey = keys[keys.length - 1];
      if (isArrayField) {
        if (!current[lastKey]) {
          current[lastKey] = [];
        }
        current[lastKey].push(value);
      } else {
        current[lastKey] = value;
      }
    }

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        const imageUrl = await uploadImageViaExternalAPI(buffer, part.filename);
        if (!newItem.catalogacao) newItem.catalogacao = {};
        if (!newItem.catalogacao.anexo) newItem.catalogacao.anexo = {};
        newItem.catalogacao.anexo.imagem = imageUrl;
      } else {
        const keys = part.fieldname.split('.');
        const lastKey = keys[keys.length - 1];
        const isArrayField = arrayFields.includes(lastKey);
        setNestedProperty(newItem, part.fieldname, part.value, isArrayField);
      }
    }

    const result = await collection.insertOne(newItem);
    const insertedItem = await collection.findOne({ _id: result.insertedId });
    reply.status(201).send(insertedItem);
  } catch (error) {
    console.error('Erro ao adicionar o item:', error);
    reply.status(500).send({ error: 'Erro ao adicionar o item' });
  }
});

// Rota para editar um item em uma coleção
fastify.put('/espolios/:collectionName/:id', async (request, reply) => {
  console.log(`PUT /espolios/${request.params.collectionName}/${request.params.id}`);
  try {
    const { collectionName, id } = request.params;
    const collection = db.collection(collectionName);
    const parts = request.parts();
    const updatedFields = {};
    const arrayFields = ['outraNumeracao', 'nucleo', 'categoria', 'materiais', 'tecnicas', 'lugares', 'intervencoes', 'objetosAssociados', 'bibliografia'];

    function setNestedProperty(obj, path, value, isArrayField) {
      const keys = path.split('.');
      let current = obj;
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key] || typeof current[key] !== 'object') {
          current[key] = {};
        }
        current = current[key];
      }
      const lastKey = keys[keys.length - 1];
      if (isArrayField) {
        if (!current[lastKey]) {
          current[lastKey] = [];
        }
        current[lastKey].push(value);
      } else {
        current[lastKey] = value;
      }
    }

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        const imageUrl = await uploadImageViaExternalAPI(buffer, part.filename);
        if (!updatedFields.catalogacao) updatedFields.catalogacao = {};
        if (!updatedFields.catalogacao.anexo) updatedFields.catalogacao.anexo = {};
        updatedFields.catalogacao.anexo.imagem = imageUrl;
      } else {
        const keys = part.fieldname.split('.');
        const lastKey = keys[keys.length - 1];
        const isArrayField = arrayFields.includes(lastKey);
        setNestedProperty(updatedFields, part.fieldname, part.value, isArrayField);
      }
    }
    
    delete updatedFields._id;
    const result = await collection.updateOne({ _id: new ObjectId(id) }, { $set: updatedFields });
    if (result.matchedCount === 0) {
      return reply.status(404).send({ error: 'Item não encontrado' });
    }
    const item = await collection.findOne({ _id: new ObjectId(id) });
    return item;
  } catch (error) {
    console.error('Erro ao editar o item:', error);
    reply.status(500).send({ error: 'Erro ao editar o item' });
  }
});

// Rota para deletar um item em uma coleção
fastify.delete('/espolios/:collectionName/:id', async (request, reply) => {
  console.log(`DELETE /espolios/${request.params.collectionName}/${request.params.id}`);
  try {
    const { collectionName, id } = request.params;
    const collection = db.collection(collectionName);
    const result = await collection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return reply.status(404).send({ error: 'Item não encontrado' });
    }
    reply.status(204).send();
  } catch (error) {
    console.error('Erro ao deletar o item:', error);
    reply.status(500).send({ error: 'Erro ao deletar o item' });
  }
});

// Iniciar o servidor
const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
    console.log('Servidor está rodando em http://localhost:3000');
  } catch (error) {
    console.error('Erro ao iniciar o servidor:', error);
    process.exit(1);
  }
};

start();
