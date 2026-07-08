import { useState } from 'react'
import { uploadImageToR2, getImageFileFromPasteEvent } from '../r2Upload'
import { supabase } from '../supabaseClient'

export default function ImageCell({ url, editable, onChange, onOpenLightbox }) {
  const [uploading, setUploading] = useState(false)

  async function handlePaste(e) {
    if (!editable) return
    const file = getImageFileFromPasteEvent(e)
    if (!file) return
    e.preventDefault()
    setUploading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const publicUrl = await uploadImageToR2(file, session.access_token)
      onChange(publicUrl)
    } catch (err) {
      alert('图片上传失败：' + err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className={`image-cell ${editable ? 'editable' : ''}`}
      tabIndex={editable ? 0 : -1}
      onPaste={handlePaste}
      title={editable ? '点击此处后 Ctrl+V 粘贴图片' : ''}
    >
      {uploading ? (
        <div className="image-placeholder">上传中...</div>
      ) : url ? (
        <img
          src={url}
          alt="商品图片"
          onClick={() => onOpenLightbox(url)}
          style={{ cursor: 'zoom-in' }}
        />
      ) : (
        <div className="image-placeholder">
          {editable ? '点击后粘贴图片' : '无图片'}
        </div>
      )}
    </div>
  )
}
