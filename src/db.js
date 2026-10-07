import { MongoClient } from 'mongodb';

export async function connectDb() {
  if (!process.env.MONGO_URI_READ || !process.env.MONGO_URI_WRITE) {
    throw new Error('Thiếu MONGO_URI_READ hoặc MONGO_URI_WRITE trong .env');
  }

  const readClient = new MongoClient(process.env.MONGO_URI_READ);
  const writeClient = new MongoClient(process.env.MONGO_URI_WRITE);

  await Promise.all([
    readClient.connect(),
    writeClient.connect()
  ]);

  const readDb = readClient.db('DB_23IT321');
  const writeDb = writeClient.db('DB_23IT321');

  return {
    readBooks: readDb.collection('books'),
    writeBooks: writeDb.collection('books'),
    readSessions: readDb.collection('sessions'),
    writeSessions: writeDb.collection('sessions')
  };
}
