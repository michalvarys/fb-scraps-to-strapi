
const puppeteer = require('puppeteer')

// const { updateDatabase } = require('./extract.js')
const fs = require('fs')

const EMAIL = process.env.FB_EMAIL || "sufursky@gmail.com"
const PASSWORD = process.env.FB_PASSWORD || "1044884559"

async function closeCookiesPopup(page) {
    await page.evaluate(() => {
        const dialogs = cument.querySelectorAll("[role=dialog]")
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

        if (!loginRequired && login.cookies) {
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

function getPostData(allData) {
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

    return postsRaw.flat().map((d) => {
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

        return { text, id, attachments, attachments_raw: d.attachments }
    }).filter(Boolean)
}

async function scrape() {
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
        // executablePath: process.env.PUPPETEER_EXEC_PATH || "google-chrome-stable",
        ignoreHTTPSErrors: true,
        dumpio: false,
        env: {
            DISPLAY: ":99.0",
        }
    });

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
                console.log(getPostData(data))
                fetchData.push(data)
            }
        } catch (error) {
            console.error('Error capturing response', error);
        }
    });

    // Navigate to the page url
    await page.goto('https://www.facebook.com/www.uat.sk', { waitUntil: 'networkidle2' });


    const htmlBefore = await page.evaluate(() => {
        return document.head.outerHTML + document.body.outerHTML
    })

    fs.writeFileSync('./page-before.html', htmlBefore)

    await page.evaluate(() => {
        document.querySelectorAll("[role=dialog] [role=button][aria-label]")?.forEach(b => b.click())
    })

    // Now the data start flowing through the GQL, lets scroll a bit to load more of it (FB infinite scrolling)
    await delay(1000)
    const scrollingCount = 10
    for (const i of [...Array(scrollingCount).keys()]) {
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight)
        })
        await delay(3000)
    }

    const html = await page.evaluate(() => {
        return document.head.outerHTML + document.body.outerHTML
    })

    fs.writeFileSync('./page.html', html)
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
    const allData = [...initialData, ...fetchData]
    // get posts raw data
    const posts = getPostData(allData)
    fs.writeFileSync('./allData.json', JSON.stringify(allData, null, 2))
    fs.writeFileSync('./posts.json', JSON.stringify(posts, null, 2))
    // Send posts to the database in reverse so that the order is from oldest to newest (posts are loaded from newest to oldest)
    console.log(posts)
    // await updateDatabase(posts.reverse())

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