
import puppeteer from 'puppeteer';
// import fs from 'fs'
import { updateDatabase } from './extract.js';

export const scrape = async () => {
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();

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
                const data = JSON.parse(fixJsonText(body))
                fetchData.push(data)
            }
        } catch (error) {
            console.error('Error capturing response', error);
        }
    });

    await page.goto('https://www.facebook.com/www.uat.sk', { waitUntil: 'networkidle2' });


    await page.evaluate(() => {
        document.querySelectorAll("[role=dialog]").item(1).querySelector("[role=button][aria-label] .xtvsq51").click()
    })

    await page.evaluate(() => {
        document.querySelectorAll("[role=dialog]").item(0).querySelector("[role=button][aria-label]").click()
    })

    await delay(1000)
    const scrollingCount = 7
    for (const i of [...Array(scrollingCount).keys()]) {
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight)
        })
        await delay(1000)
    }

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

    const allData = [...initialData, ...fetchData]
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