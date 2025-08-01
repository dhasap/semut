const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();

// --- Middleware ---
app.use(cors());

// --- Konfigurasi Dasar ---
const BASE_URL = "https://soulscans.my.id";
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': `${BASE_URL}/`
};

// --- Fungsi Helper ---
const dapatkanHtml = async (url) => {
    try {
        const { data } = await axios.get(url, { headers: HEADERS });
        return cheerio.load(data);
    } catch (error) {
        console.error(`Error saat mengakses ${url}:`, error.message);
        return null;
    }
};

// Fungsi untuk mem-parse kartu komik yang sering muncul
const parseComicCard = ($, el, api) => {
    const judul = $(el).find('a').attr('title');
    const url = $(el).find('a').attr('href');
    let gambar_sampul = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
    
    if (gambar_sampul) {
        // Pastikan URL gambar lengkap sebelum di-encode
        if (gambar_sampul.startsWith('//')) {
            gambar_sampul = 'https:' + gambar_sampul;
        }
        // Gunakan URL API lengkap untuk proxy
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

// [PERBAIKAN] Endpoint Image Proxy
app.get('/api/image', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('URL gambar tidak ditemukan');

    try {
        // URL sudah di-decode oleh Express, jadi tidak perlu decode lagi.
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

// [BARU] Endpoint untuk komik "Hot" / "Popular Today"
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


// Endpoint Pencarian
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

// Endpoint Daftar Seri (Gambar)
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

// Endpoint Daftar Seri (Teks)
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

// Endpoint Detail Seri
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

// Endpoint Gambar Chapter
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

// Endpoint Daftar Genre
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

// Endpoint Komik per Genre
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

// Endpoint Daftar Status
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

// Endpoint Komik per Status
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

// Export aplikasi Express
module.exports = app;
