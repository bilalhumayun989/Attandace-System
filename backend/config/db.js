const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

// Used for serverless connections caching
let cached = global.mongoose;
if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
    if (cached.conn) {
        return cached.conn;
    }

    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is missing in environment variables');
    }

    if (!cached.promise) {
        const opts = {
            serverSelectionTimeoutMS: 5000,
            family: 4
        };

        cached.promise = mongoose.connect(process.env.MONGO_URI, opts).then((mongoose) => {
            console.log(`MongoDB Connected: ${mongoose.connection.host}`);
            return mongoose;
        }).catch((err) => {
            console.error(`MongoDB Connection Error: ${err.message}`);
            console.error('Make sure your IP is whitelisted in MongoDB Atlas and MONGO_URI is set correctly.');
            cached.promise = null;
            throw err;
        });
    }

    try {
        cached.conn = await cached.promise;
    } catch (e) {
        cached.promise = null;
        throw e;
    }

    return cached.conn;
};

module.exports = connectDB;
