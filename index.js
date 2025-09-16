// Importando o módulo Fastify
const fastify = require('fastify')();
const { MongoClient, ObjectId } = require('mongodb');

// Configurações do MongoDB
const mongoUrl = 'mongodb://localhost:27017';
const dbName = 'gestao_espolios';

let db;

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

// Rota para obter todos os itens de uma coleção
fastify.get('/espolios/:collectionName', async (request, reply) => {
  try {
    const { collectionName } = request.params;
    const collection = db.collection(collectionName);
    const items = await collection.find().toArray();
    return items;
  } catch (error) {
    reply.status(500).send({ error: 'Erro ao buscar itens' });
  }
});

// Rota para obter um item por ID de uma coleção
fastify.get('/espolios/:collectionName/:id', async (request, reply) => {
  try {
    const { collectionName, id } = request.params;
    const collection = db.collection(collectionName);
    const item = await collection.findOne({ _id: new ObjectId(id) });
    if (!item) {
      return reply.status(404).send({ error: 'Item não encontrado' });
    }
    return item;
  } catch (error) {
    reply.status(500).send({ error: 'Erro ao buscar o item' });
  }
});

// Rota para adicionar um novo item em uma coleção
fastify.post('/espolios/:collectionName', async (request, reply) => {
  try {
    const { collectionName } = request.params;
    const collection = db.collection(collectionName);
    const newItem = request.body;
    const result = await collection.insertOne(newItem);
    const insertedItem = await collection.findOne({ _id: result.insertedId });
    reply.status(201).send(insertedItem);
  } catch (error) {
    reply.status(500).send({ error: 'Erro ao adicionar o item' });
  }
});

// Rota para editar um item em uma coleção
fastify.put('/espolios/:collectionName/:id', async (request, reply) => {
  try {
    const { collectionName, id } = request.params;
    const collection = db.collection(collectionName);
    const updatedItem = request.body;
    const result = await collection.updateOne({ _id: new ObjectId(id) }, { $set: updatedItem });
    if (result.matchedCount === 0) {
      return reply.status(404).send({ error: 'Item não encontrado' });
    }
    const item = await collection.findOne({ _id: new ObjectId(id) });
    return item;
  } catch (error) {
    reply.status(500).send({ error: 'Erro ao editar o item' });
  }
});

// Rota para deletar um item em uma coleção
fastify.delete('/espolios/:collectionName/:id', async (request, reply) => {
  try {
    const { collectionName, id } = request.params;
    const collection = db.collection(collectionName);
    const result = await collection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return reply.status(404).send({ error: 'Item não encontrado' });
    }
    reply.status(204).send();
  } catch (error) {
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