// File: index.js - Versi UTUH dengan KUNCI PUPPETEER + CCTV (Lengkap)

const express = require('express');
const cheerio = require('cheerio');
const cors = require('cors');
// [PENAMBAHAN] Kita butuh dependensi untuk Puppeteer
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
// [PENAMBAHAN] Kita butuh axios hanya untuk proxy gambar
const axios = require('axios');


const app = express();
app.use(cors());

const BASE_URL = "https://soulscans.my.id";
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/5.37.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': `${BASE_URL}/`
};


// =======================================================================
// ||             >>> FUNGSI INI DI-UPGRADE MENJADI PUPPETEER <<<         ||
// =======================================================================
const dapatkanHtml = async (url) => {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        await page.setUserAgent(HEADERS['User-Agent']);
        await page.setExtraHTTPHeaders({ 'Referer': HEADERS['Referer'] });
        
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 35000 });
        
        // ======== CCTV YANG KAMU MINTA, TERPASANG DI SINI ========
        const htmlContent = await page.content();
        console.log(`===== START: HTML content for ${url} =====`);
        console.log(htmlContent);
        console.log(`===== END: HTML content for ${url} =====`);
        // =======================================================

        return cheerio.load(htmlContent);

    } catch (error) {
        console.error(`Error saat mengakses ${url} dengan Puppeteer:`, error.message);
        return null;
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }
};


// =====================================================================
// ||         SEMUA KODE DI BAWAH INI ADALAH 100% KODEMU ASLI           ||
// =====================================================================

// --- Fungsi Helper ---
const parseComicCard = ($, el, api) => {
    const judul = $(el).find('a').attr('title');
    const url = $(el).find('a').attr('href');
    let gambar_sampul = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
    
    if (gambar_sampul) {
        if (gambar_sampul.startsWith('//')) {
            gambar_sampul = 'https:' + gambar_sampul;
        }
        gambar_sampul = `${api}/image?url=${encodeURIComponent(gambar_sampul.trim())}`;
    } else {
        gambar_sampul = "Tidak ada gambar";
    }

    if (judul && url) {
        return {
            judul,
            url,
            gambar_sampul
        };
    }
    return null;
};

const getFullApiUrl = (req) => {
    return `${req.protocol}://${req.get('host')}/api`;
}

// --- Endpoint API ---

app.get('/api/image', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('URL gambar tidak ditemukan');

    try {
        const response = await axios({
            method: 'get',
            url: imageUrl,
            responseType: 'stream',
            headers: { ...HEADERS }
        });
        res.setHeader('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
    } catch (error) {
        console.error(`Gagal mem-proxy gambar ${imageUrl}:`, error.message);
        res.status(500).send('Gagal mengambil gambar');
    }
});

app.get('/api/hot', async (req, res) => {
    console.log("Menerima request untuk /api/hot");
    const $ = await dapatkanHtml(BASE_URL);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil data hot.' });

    const daftarHot = [];
    const apiUrl = getFullApiUrl(req);
    $('div.bixbox.hothome .listupd .bs .bsx').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) daftarHot.push(comic);
    });
    res.json(daftarHot);
});

app.get('/api/search/:query', async (req, res) => {
    const searchQuery = req.params.query;
    const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(searchQuery)}`;
    const $ = await dapatkanHtml(searchUrl);
    if (!$) return res.status(500).json({ error: `Gagal mencari "${searchQuery}".` });
    
    const hasilPencarian = [];
    const apiUrl = getFullApiUrl(req);
    $('div.listupd .bs .bsx').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) hasilPencarian.push(comic);
    });
    res.json(hasilPencarian);
});

app.get('/api/series', async (req, res) => {
    const listUrl = `${BASE_URL}/series/`;
    const $ = await dapatkanHtml(listUrl);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil data seri.' });
    
    const daftarSeri = [];
    const apiUrl = getFullApiUrl(req);
    $('div.utao .uta .bsx').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) daftarSeri.push(comic);
    });
    res.json(daftarSeri);
});

app.get('/api/list', async (req, res) => {
    const listUrl = `${BASE_URL}/manga/list-mode/`;
    const $ = await dapatkanHtml(listUrl);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil data list.' });
    
    const daftarSeri = [];
    $('div.soralist .blix ul li a').each((i, el) => {
        const judul = $(el).text().trim();
        const url = $(el).attr('href');
        if (judul && url) daftarSeri.push({ judul, url });
    });
    res.json(daftarSeri);
});

app.get('/api/detail', async (req, res) => {
    const seriUrl = req.query.url;
    if (!seriUrl || !seriUrl.startsWith(BASE_URL)) return res.status(400).json({ error: 'URL seri tidak valid.' });
    
    const $ = await dapatkanHtml(seriUrl);
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

app.get('/api/chapter', async (req, res) => {
    const chapterUrl = req.query.url;
    if (!chapterUrl || !chapterUrl.startsWith(BASE_URL)) return res.status(400).json({ error: 'URL chapter tidak valid.' });
    
    const $ = await dapatkanHtml(chapterUrl);
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

app.get('/api/genres', async (req, res) => {
    const genrePageUrl = `${BASE_URL}/manga/`;
    const $ = await dapatkanHtml(genrePageUrl);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil daftar genre.' });
    
    const daftarGenre = [];
    $('ul.dropdown-menu.c4.genrez li label').each((i, el) => {
        const label = $(el).text().trim();
        if (label) {
            const slug = label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            daftarGenre.push({ nama: label, slug });
        }
    });
    res.json(daftarGenre);
});

app.get('/api/genres/:slug', async (req, res) => {
    const genreSlug = req.params.slug;
    const genreUrl = `${BASE_URL}/genres/${genreSlug}/`;
    const $ = await dapatkanHtml(genreUrl);
    if (!$) return res.status(500).json({ error: `Gagal mengambil data genre ${genreSlug}.` });
    
    const daftarSeri = [];
    const apiUrl = getFullApiUrl(req);
    $('div.listupd .bs .bsx').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) daftarSeri.push(comic);
    });
    res.json(daftarSeri);
});

app.get('/api/status', async (req, res) => {
    const mangaPageUrl = `${BASE_URL}/manga/`;
    const $ = await dapatkanHtml(mangaPageUrl);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil daftar status.' });
    
    const daftarStatus = [];
    $('div.filter.dropdown:has(button:contains("Status")) ul.dropdown-menu li').each((i, el) => {
        const label = $(el).find('label').text().trim();
        const value = $(el).find('input[type="radio"]').val();
        if (label && value) daftarStatus.push({ nama: label, slug: value });
    });
    res.json(daftarStatus);
});

app.get('/api/status/:slug', async (req, res) => {
    const statusSlug = req.params.slug;
    const statusUrl = `${BASE_URL}/manga/?status=${statusSlug}`;
    const $ = await dapatkanHtml(statusUrl);
    if (!$) return res.status(500).json({ error: `Gagal mengambil data status ${statusSlug}.` });
    
    const daftarSeri = [];
    const apiUrl = getFullApiUrl(req);
    $('div.listupd .bs .bsx').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) daftarSeri.push(comic);
    });
    res.json(daftarSeri);
});

module.exports = app;
