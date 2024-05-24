import express from 'express'
import { scrape } from './src/scrape.js';
import dotenv from 'dotenv'
dotenv.config();

const PORT = process.env.PORT || 8080

const app = express();
app.post('/fb', async (req, res) => {
    try {
        await scrape()
        res.send({ success: true });
    } catch (err) {
        res.send({ success: false, error: err.message })
    }
});


app.listen(PORT).on('listening', () => {
    console.log(`listening on port ${PORT}`)
})