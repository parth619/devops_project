const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');
const multer = require('multer');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.use('/images', express.static(path.join(__dirname, 'images')));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB
    },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
            return cb(new Error('Please upload a valid image file.'));
        }
        cb(null, true);
    }
});

app.get('/', (req, res) => {
    res.render('index');
});

app.post('/generate', upload.single('student_photo'), async (req, res) => {
    const { prefix, name, className, mother_name, dob, dob_in_words, caste, admission_no } = req.body;
    const studentPhotoDataUrl = req.file
        ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
        : '';

    let browser;
    try {
        // Ensure images exist before proceeding
        const sealPath = path.join(__dirname, 'images', 'school_seal.png');
        const signPath = path.join(__dirname, 'images', 'headmaster_sign.png');

        if (!fs.existsSync(sealPath) || !fs.existsSync(signPath)) {
            throw new Error("Image files missing in /images folder!");
        }

        const sealBase64 = fs.readFileSync(sealPath, 'base64');
        const signBase64 = fs.readFileSync(signPath, 'base64');

        browser = await puppeteer.launch({ 
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'] 
        });
        
        const page = await browser.newPage();

        const html = await new Promise((resolve, reject) => {
            res.render('template', { 
                prefix, student_name: name, className, mother_name, 
                dob, dob_in_words, caste, admission_no,
                student_photo_url: studentPhotoDataUrl,
                sealData: `data:image/png;base64,${sealBase64}`,
                signData: `data:image/png;base64,${signBase64}`
            }, (err, html) => {
                if (err) reject(err);
                resolve(html);
            });
        });

        // Increase timeout and wait for everything to settle
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
        
        // Brief pause to ensure rendering is complete
        await new Promise(r => setTimeout(r, 500));

        const pdfBytes = await page.pdf({ 
            format: 'A4',
            landscape: true,
            printBackground: true,
            preferCSSPageSize: true,
            margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' }
        });

        // puppeteer may return Uint8Array; Express would JSON-serialize that unless we convert to Buffer
        const pdfBuffer = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);

        await browser.close();

        // Check if buffer is valid
        if (pdfBuffer.length < 100) {
            throw new Error("Generated PDF is empty.");
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=bonafide.pdf');
        res.setHeader('Content-Length', String(pdfBuffer.length));
        res.send(pdfBuffer);

    } catch (error) {
        if (browser) await browser.close();
        console.error("CRITICAL ERROR:", error);
        res.status(500).send(`<h1>Generation Failed</h1><p>${error.message}</p>`);
    }
});

app.listen(3000, () => console.log(`✅ System Active at http://localhost:3000`));