const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
// Import Puppeteer
const puppeteer = require('puppeteer-core');
const chrome = require('chrome-aws-lambda');

const app = express();
app.use(cors());

// URL target utama
const WEB_URL = 'https://komiku.org';

const getFullApiUrl = (req) => `${req.protocol}://${req.get('host')}/api`;

// Fungsi parsing yang disesuaikan untuk halaman /daftar-komik/
const parseDaftarKomikCard = ($, el, apiUrl) => {
    const judul = $(el).find('div.bge h3').text().trim();
    const url = $(el).find('a').attr('href');
    let gambar_sampul = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');
    const chapter = $(el).find('div.bge .chp').first().text().trim();

    if (gambar_sampul) {
        gambar_sampul = `${apiUrl}/image?url=${encodeURIComponent(gambar_sampul.trim().split('?')[0])}`;
    }

    if (judul && url) {
        return { judul, chapter, gambar_sampul, url };
    }
    return null;
};

// --- Endpoint API ---

app.get('/api/image', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL gambar tidak ditemukan');
    try {
        const response = await axios.get(url, {
            responseType: 'stream',
            headers: { 'Referer': WEB_URL }
        });
        res.setHeader('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('Gagal mengambil gambar');
    }
});

// [PERBAIKAN FINAL] Endpoint ini sekarang menggunakan scroll dinamis sampai akhir
app.get('/api/daftar-komik', async (req, res) => {
    let browser = null;
    try {
        // Konfigurasi Puppeteer untuk Vercel
        browser = await puppeteer.launch({
            args: chrome.args,
            executablePath: await chrome.executablePath,
            headless: chrome.headless,
        });

        const page = await browser.newPage();
        await page.goto(`${WEB_URL}/daftar-komik/`, { waitUntil: 'networkidle2' });

        // --- PERBAIKAN UTAMA: Logika scroll dinamis ---
        let previousHeight = 0;
        let currentHeight = await page.evaluate('document.body.scrollHeight');
        // Loop akan terus berjalan selama halaman masih bertambah tinggi (ada konten baru)
        while (previousHeight < currentHeight) {
            previousHeight = currentHeight;
            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
            // Tunggu sebentar untuk memastikan konten baru (jika ada) sudah dimuat
            await new Promise(resolve => setTimeout(resolve, 2000)); // Tunggu 2 detik
            currentHeight = await page.evaluate('document.body.scrollHeight');
        }
        // --- Akhir Perbaikan ---

        const content = await page.content();
        const $ = cheerio.load(content);
        
        const comics = [];
        const apiUrl = getFullApiUrl(req);
        
        $('div.bge').each((i, el) => {
            const comic = parseDaftarKomikCard($, el, apiUrl);
            if (comic) comics.push(comic);
        });

        if (comics.length === 0) {
            return res.status(404).json({ success: false, message: 'Tidak ada komik yang ditemukan.' });
        }

        // Karena ini mengambil semua, kita tidak perlu paginasi lagi
        res.json({
            success: true,
            data: comics
        });

    } catch (error) {
        console.error("Error di endpoint /daftar-komik dengan Puppeteer:", error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data dari Komiku.' });
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }
});

// Endpoint lainnya bisa tetap menggunakan axios jika tidak memerlukan eksekusi JS
// ...

module.exports = app;
