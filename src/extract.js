import fetch from 'node-fetch'
import FormData from 'form-data';
import axios from 'axios'
import dotenv from 'dotenv'
dotenv.config();

// TODO replace with env variables
const BASE_URL = process.env.BASE_URL || "http://localhost:1337";
const EMAIL = process.env.EMAIL
const PASSWORD = process.env.PASSWORD

axios.defaults.baseURL = BASE_URL
async function main() {
    const response = await axios.post(`/admin/login`, {
        email: EMAIL,
        password: PASSWORD
    })

    const { token } = response.data?.data || {}
    if (!token) {
        throw new Error("Couldn't get the auth token")
    }

    axios.defaults.headers = {
        Authorization: `Bearer ${token}`,
    }
}

async function uploadImage(url) {
    if (!url) {
        return
    }

    const form = new FormData();
    const arrayBuffer = await fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Network response was not ok: ${response.statusText}`);
            }
            return response.arrayBuffer();
        })

    const buffer = Buffer.from(arrayBuffer);
    form.append('files', buffer, {
        filename: 'downloaded_file_' + Date.now() + '.jpeg',
        contentType: 'image/jpeg'
    })

    const response = await axios.post("/upload", form, {
        headers: form.getHeaders(),
    })

    if (!response.ok) {
        return
    }

    return response.json()
}

export async function updateDatabase(posts) {
    await main()
    for (const post of posts) {
        try {
            const fbPost = await axios.get(`/news/fb/${post.id}`)

            if (fbPost) {
                continue
            }
        }

        catch {
            const images = await Promise.all(post.attachments.map(a => uploadImage(a?.viewer_image?.uri || a?.large_share_image?.uri)))

            const gallery_item = images.filter(Boolean).map(image => ({
                fullsize: image,
                thumbnail_410x551: image
            }))

            const sections = [
                {
                    content: post.text.split('\n').map(e => `<p>${e}</p>`).join(''),
                    __component: "shared.rich-text-with-title",
                },
            ]

            if (gallery_item.length) {
                sections.push({
                    __component: "shared.gallery",
                    title: null,
                    gallery_item
                })
            }

            const { data } = await axios.post(`/news`, {
                facebook_id: post.id,
                published_at: null,
                date: new Date().toJSON(),
                important_news: false,
                title: post.text.slice(0, 40),
                sections
            })

            if (data.error) {
                console.log(data)
            }
        }
    }
}