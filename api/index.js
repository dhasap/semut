const express = require('express');
const cheerio = require('cheerio');
const cors = require('cors');
const chromium = require('@sparticuz/chromium');
// [PERUBAHAN] Gunakan puppeteer-extra
const puppeteer = require('puppeteer-extra');
// [PERUBAHAN] Tambahkan plugin stealth
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

// [PERUBAHAN] Aktifkan plugin stealth
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());

const BASE_URL = "https://soulscans.my.id";

// --- Fungsi Pengambil HTML dengan Puppeteer STEALTH MODE ---
const dapatkanHtml = async (url) => {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Pergi ke halaman dan tunggu sampai semua konten dimuat
        // Plugin stealth akan menangani penyamaran secara otomatis
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
        
        const content = await page.content();
        return cheerio.load(content);

    } catch (error) {
        console.error(`Error Puppeteer (Stealth) saat mengakses ${url}:`, error.message);
        return null;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
};

// --- Fungsi Helper (Tidak ada perubahan) ---
const parseComicCard = ($, el, api) => {
    const judul = $(el).find('a').attr('title');
    const url = $(el).find('a').attr('href');
    let gambar_sampul = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
    
    if (gambar_sampul) {
        if (gambar_sampul.startsWith('//')) gambar_sampul = 'https:' + gambar_sampul;
        gambar_sampul = `${api}/image?url=${encodeURIComponent(gambar_sampul.trim())}`;
    } else {
        gambar_sampul = "Tidak ada gambar";
    }

    if (judul && url) return { judul, url, gambar_sampul };
    return null;
};

const getFullApiUrl = (req) => `${req.protocol}://${req.get('host')}/api`;

// --- Endpoint API (Tidak ada perubahan logika, hanya engine-nya yang lebih kuat) ---

// Image Proxy
app.get('/api/image', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL gambar tidak ditemukan');
    try {
        const response = await axios.get(url, { 
            responseType: 'stream', 
            headers: { 'Referer': BASE_URL } 
        });
        res.setHeader('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('Gagal mengambil gambar');
    }
});

// Pencarian
app.get('/api/search/:query', async (req, res) => {
    const { query } = req.params;
    const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
    const $ = await dapatkanHtml(searchUrl);
    if (!$) return res.status(500).json({ error: `Gagal mencari "${query}".` });
    
    const hasil = [];
    const apiUrl = getFullApiUrl(req);
    $('div.listupd .bs .bsx').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) hasil.push(comic);
    });
    res.json(hasil);
});

// Detail Komik
app.get('/api/detail', async (req, res) => {
    const { url } = req.query;
    if (!url || !url.startsWith(BASE_URL)) return res.status(400).json({ error: 'URL seri tidak valid.' });
    
    const $ = await dapatkanHtml(url);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil detail seri.' });
    
    const deskripsi = $('div[itemprop="description"] p').text().trim() || "Deskripsi tidak ditemukan.";
    const daftarChapter = [];
    $('div.eplister ul li a').each((i, el) => {
        const judulChapter = $(el).find('.chapternum').text().trim();
        const urlChapter = $(el).attr('href');
        if (judulChapter && urlChapter) daftarChapter.push({ judul_chapter: judulChapter, url_chapter: urlChapter });
    });
    res.json({ deskripsi, chapters: daftarChapter });
});

// Gambar Chapter
app.get('/api/chapter', async (req, res) => {
    const { url } = req.query;
    if (!url || !url.startsWith(BASE_URL)) return res.status(400).json({ error: 'URL chapter tidak valid.' });
    
    const $ = await dapatkanHtml(url);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil gambar chapter.' });
    
    const daftarGambar = [];
    const apiUrl = getFullApiUrl(req);
    $('div#readerarea img').each((i, el) => {
        let imgUrl = $(el).attr('src') || $(el).attr('data-src');
        if (imgUrl) {
            imgUrl = imgUrl.trim();
            if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
            daftarGambar.push(`${apiUrl}/image?url=${encodeURIComponent(imgUrl)}`);
        }
    });
    res.json(daftarGambar);
});

// Endpoint yang mengembalikan list komik
const setupListEndpoint = (path, selector) => {
    app.get(path, async (req, res) => {
        const url = `${BASE_URL}${req.originalUrl.replace('/api', '')}`;
        const $ = await dapatkanHtml(url);
        if (!$) return res.status(500).json({ error: `Gagal mengambil data dari ${path}` });
        
        const results = [];
        const apiUrl = getFullApiUrl(req);
        $(selector).each((i, el) => {
            const comic = parseComicCard($, el, apiUrl);
            if (comic) results.push(comic);
        });
        res.json(results);
    });
};

setupListEndpoint('/api/series', 'div.utao .uta .bsx');
setupListEndpoint('/api/genres/:slug', 'div.listupd .bs .bsx');
setupListEndpoint('/api/status/:slug', 'div.listupd .bs .bsx');
setupListEndpoint('/api/hot', 'div.bixbox.hothome .listupd .bs .bsx');

// Endpoint yang mengembalikan list teks
app.get('/api/genres', async (req, res) => {
    const $ = await dapatkanHtml(`${BASE_URL}/manga/`);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil daftar genre.' });
    const genres = $('ul.dropdown-menu.c4.genrez li label').map((i, el) => {
        const label = $(el).text().trim();
        return label ? { nama: label, slug: label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') } : null;
    }).get();
    res.json(genres);
});

app.get('/api/status', async (req, res) => {
    const $ = await dapatkanHtml(`${BASE_URL}/manga/`);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil daftar status.' });
    const statuses = $('div.filter.dropdown:has(button:contains("Status")) ul.dropdown-menu li').map((i, el) => {
        const label = $(el).find('label').text().trim();
        const value = $(el).find('input[type="radio"]').val();
        return (label && value) ? { nama: label, slug: value } : null;
    }).get();
    res.json(statuses);
});

// Export aplikasi Express
module.exports = app;
