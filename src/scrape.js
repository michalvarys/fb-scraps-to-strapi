
import puppeteer from 'puppeteer';

import { updateDatabase } from './extract.js';
import fs from 'fs'

import dotenv from 'dotenv'
dotenv.config();

const EMAIL = process.env.FB_EMAIL
const PASSWORD = process.env.FB_PASSWORD

async function closeCookiesPopup(page) {
    await page.evaluate(() => {
        const dialogs = document.querySelectorAll("[role=dialog]")
        const dialog = dialogs.item(1) || dialogs.item(0)
        const btn = dialog?.querySelector("[role=button][aria-label] .xtvsq51")
        btn?.click()
    })
}

async function getFacebookCookies(browser) {
    const loginDataPath = "cookies.json"

    // Read cookies from file
    try {
        const login = JSON.parse(fs.readFileSync(loginDataPath, 'utf8'));
        const loginRequired = !login || (new Date() - new Date(login.loginDate)) > 3 * 24 * 60 * 60 * 1000;

        if (!loginRequired) {
            return login.cookies
        }
    } catch {

    }

    // cookies expired or non-existent
    const page = await browser.newPage();

    // Go to Facebook login page
    await page.goto('https://www.facebook.com/');

    await page.waitForSelector('[role=dialog]')
    await closeCookiesPopup(page)

    // Enter credentials
    await page.type('#email', EMAIL);
    await page.type('#pass', PASSWORD);

    // Click on login button
    await page.evaluate(() => {
        document.querySelector('button[name="login"]').click()
    })

    // Wait for navigation
    await page.waitForNavigation();

    const cookies = await page.cookies();

    const loginData = {
        cookies,
        loginDate: new Date().toISOString()
    };
    // save cookies to the file
    fs.writeFileSync('cookies.json', JSON.stringify(loginData, null, 2));

    return cookies
}

export const scrape = async () => {
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    const cookies = await getFacebookCookies(browser)

    const page = await browser.newPage();
    await page.setCookie(...cookies);

    await page.setRequestInterception(true);
    page.on('request', request => {
        // Continue with the request
        request.continue();
    });

    const fetchData = []
    page.on('response', async response => {
        let body
        try {
            // Check if the response is a GraphQL response
            const url = response.url();
            if (url.includes('graphql')) {
                body = await response.text()
                // * Data are coming in text format, even though the object is in correct format, there are commas and brackets missing
                // * let's fix that and push the data to the array
                const data = JSON.parse(fixJsonText(body))
                fetchData.push(data)
            }
        } catch (error) {
            console.error('Error capturing response', error);
        }
    });

    // Navigate to the page url
    await page.goto('https://www.facebook.com/www.uat.sk', { waitUntil: 'networkidle2', referrerPolicy: 'no-referrer' });


    // Now the data start flowing through the GQL, lets scroll a bit to load more of it (FB infinite scrolling)
    await delay(1000)
    const scrollingCount = 7
    for (const i of [...Array(scrollingCount).keys()]) {
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight)
        })
        await delay(1000)
    }

    // Prefetched data (first post and some page information) needs to be extracted from the DOM to have complete feed
    const initialData = await page.evaluate(() => {
        const allData = [];
        for (const el of document.querySelectorAll("script[type=\"application/json\"]").values()) {
            if (!el.innerText.contains("timeline_list_feed_units")) continue;

            const data = JSON.parse(el.innerText);
            allData.push(data.require.flat());
        }

        return allData.flat().flatMap(
            val => val && typeof val === 'object' && 'map' in val &&
                val.flatMap(val => val?.__bbox?.require)
        )
            .flat()
            .filter(Boolean)
            .flat()
            .filter(val =>
                typeof val === 'object' &&
                '__bbox' in val
            ).flatMap(val => val.__bbox.result)
    })

    // data from GraphQL requests merged with the prefetched data
    // reverse the array to push older posts first
    const allData = [...initialData, ...fetchData].reverse()

    // get posts raw data
    const postsRaw = []
    allData.flat().forEach((d) => {
        const units = d?.data?.node?.timeline_list_feed_units || d?.data?.user?.timeline_list_feed_units

        units?.edges?.forEach((d) => {
            const post = d.node?.comet_sections?.content?.story
            if (post) {
                postsRaw.push(post)
            }
        })
    })

    // fs.writeFileSync('./postsRaw.json', JSON.stringify(postsRaw, null, 2))
    // fs.writeFileSync('./allData.json', JSON.stringify(allData, null, 2))

    // Serialize to required format 
    const posts = []
    postsRaw.flat().forEach((d) => {
        const text = d.message?.text || d.message?.story?.message?.text
        const id = d.id
        if (!text) {
            return
        }

        const [attachment] = d.attachments.map(a => a.styles.attachment)
        let attachments
        if (attachment?.all_subattachments) {
            attachments = attachment.all_subattachments.nodes.map(a => a.media)
        } else if (attachment) {
            attachments = [attachment.media]
        } else {
            attachments = []
        }

        posts.push({ text, id, attachments, attachments_raw: d.attachments })
    })

    // fs.writeFileSync('./posts.json', JSON.stringify(posts, null, 2))
    // Send posts to the database
    await updateDatabase(posts)

    await browser.close();
}

function fixJsonText(brokenJsonText) {
    // Split the text by new lines to handle each object separately
    const lines = brokenJsonText.split('\n').filter(line => line.trim() !== '');

    // Join the lines with commas and wrap them in an array
    const fixedJsonArray = lines.map(line => line.trim()).join(',');

    return `[${fixedJsonArray}]`;
}

function delay(time) {
    return new Promise(function (resolve) {
        setTimeout(resolve, time);
    });
}

scrape()