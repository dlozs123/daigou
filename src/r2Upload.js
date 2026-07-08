// 通过 Cloudflare Worker 获取预签名 URL，然后直接把图片 PUT 到 R2
// WORKER_URL 需要替换成你部署的 Worker 地址（见 worker/README 说明）
const WORKER_URL = import.meta.env.VITE_R2_WORKER_URL

/**
 * 上传图片文件到 R2，返回可访问的公开 URL
 * @param {File|Blob} file
 * @param {string} accessToken - supabase session 的 access_token，用于 Worker 校验身份
 */
export async function uploadImageToR2(file, accessToken) {
  const ext = (file.type && file.type.split('/')[1]) || 'png'
  const key = `items/${crypto.randomUUID()}.${ext}`

  // 1. 向 Worker 请求预签名上传 URL
  const signRes = await fetch(`${WORKER_URL}/sign-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ key, contentType: file.type || 'image/png' }),
  })

  if (!signRes.ok) {
    throw new Error('获取上传签名失败: ' + (await signRes.text()))
  }
  const { uploadUrl, publicUrl } = await signRes.json()

  // 2. 直接 PUT 文件到 R2
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'image/png' },
    body: file,
  })

  if (!putRes.ok) {
    throw new Error('图片上传到 R2 失败')
  }

  return publicUrl
}

/**
 * 支持从剪贴板粘贴事件中提取图片文件
 */
export function getImageFileFromPasteEvent(e) {
  const items = e.clipboardData && e.clipboardData.items
  if (!items) return null
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      return item.getAsFile()
    }
  }
  return null
}
