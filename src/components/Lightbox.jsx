export default function Lightbox({ url, onClose }) {
  if (!url) return null
  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <img src={url} alt="放大预览" className="lightbox-img" />
    </div>
  )
}
