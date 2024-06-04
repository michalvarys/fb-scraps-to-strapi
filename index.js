import express from 'express'
import { scrape } from './src/scrape.js';
import dotenv from 'dotenv'
import serveStatic from 'serve-static'
dotenv.config();

const PORT = process.env.PORT || 8080

const app = express();
app.use(serveStatic('public', { maxAge: 0 }));
app.post('/fb', async (req, res) => {
    try {
        const posts = await scrape()
        res.send({ success: true, posts });
    } catch (err) {
        res.send({ success: false, error: err.message })
    }
});

app.listen(PORT).on('listening', () => {
    console.log(`listening on port ${PORT}`)
})