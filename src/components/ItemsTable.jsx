import { useState } from 'react'
import ImageCell from './ImageCell'
import { sortByOrder, makeLabel, formatMoney } from '../lib/helpers'

/**
 * 通用商品表格
 * status: 'pending' | 'purchased' | 'shipped'
 * role: 'admin' | 'user'
 */
export default function ItemsTable({
  items,
  status,
  role,
  labelPrefix,
  selectedIds,
  onToggleSelect,
  onSelectMergeColumn,
  mergeColumn,
  onUpdateItem,
  onOpenLightbox,
  packagesMap, // { package_id: package对象 }（仅 shipped 用）
  onUpdatePackage,
}) {
  const isAdmin = role === 'admin'
  const sorted = sortByOrder(items)

  const mergeableColumns =
    status === 'pending'
      ? ['est_price', 'local_shipping', 'price_converted']
      : status === 'purchased'
      ? ['actual_price']
      : []

  const columnLabels = {
    est_price: '预估商品价格',
    local_shipping: '岛内运费',
    price_converted: '价格换算',
    actual_price: '实际价格',
  }

  function editableCell(colKey) {
    if (!isAdmin) return false
    if (status === 'pending') return true // 所有列管理员可编辑
    if (status === 'purchased') return colKey === 'note' || colKey === 'actual_price'
    if (status === 'shipped') return colKey === 'note'
    return false
  }

  function renderMoneyCell(item, colKey) {
    const isMergedHidden =
      item.merge_group_id && item.merge_column === colKey && item[colKey] === null
    if (isMergedHidden) {
      return <span className="merged-placeholder">↑合并</span>
    }
    const editable = editableCell(colKey)
    if (editable) {
      return (
        <input
          type="number"
          className="cell-input"
          value={item[colKey] ?? ''}
          onChange={(e) =>
            onUpdateItem(item.id, { [colKey]: e.target.value === '' ? null : Number(e.target.value) })
          }
        />
      )
    }
    return <span>{item[colKey] === null || item[colKey] === undefined ? '-' : formatMoney(item[colKey])}</span>
  }

  function renderRow(item, idx) {
    const label = makeLabel(labelPrefix, idx)
    return (
      <tr key={item.id} className={item.merge_group_id ? 'merged-row' : ''}>
        <td className="col-check">
          <input
            type="checkbox"
            checked={selectedIds.includes(item.id)}
            onChange={() => onToggleSelect(item.id)}
          />
        </td>
        <td className="col-label">{label}</td>
        <td className="col-image">
          <ImageCell
            url={item.image_url}
            editable={isAdmin && status === 'pending'}
            onChange={(url) => onUpdateItem(item.id, { image_url: url })}
            onOpenLightbox={onOpenLightbox}
          />
        </td>
        <td className="col-name">
          {isAdmin ? (
            <input
              className="cell-input"
              value={item.name ?? ''}
              disabled={!editableCell('name') && status !== 'pending'}
              onChange={(e) => onUpdateItem(item.id, { name: e.target.value })}
            />
          ) : (
            <span>{item.name}</span>
          )}
        </td>
        {isAdmin && (
          <td className="col-link">
            {status === 'pending' ? (
              <input
                className="cell-input"
                placeholder="粘贴商品链接"
                value={item.link ?? ''}
                onChange={(e) => onUpdateItem(item.id, { link: e.target.value })}
              />
            ) : item.link ? (
              <a href={item.link} target="_blank" rel="noreferrer">
                跳转
              </a>
            ) : (
              '-'
            )}
          </td>
        )}
        <td className="col-money">{renderMoneyCell(item, 'est_price')}</td>
        <td className="col-money">{renderMoneyCell(item, 'local_shipping')}</td>
        <td className="col-money">{renderMoneyCell(item, 'price_converted')}</td>
        {status !== 'pending' && (
          <td className="col-money">{renderMoneyCell(item, 'actual_price')}</td>
        )}
        <td className="col-note">
          <input
            className="cell-input"
            value={item.note ?? ''}
            disabled={!isAdmin}
            onChange={(e) => onUpdateItem(item.id, { note: e.target.value })}
          />
        </td>
      </tr>
    )
  }

  function renderTableBlock(rows) {
    return (
      <table className="items-table">
        <thead>
          <tr>
            <th></th>
            <th>编号</th>
            <th>图片</th>
            <th>商品名称</th>
            {isAdmin && <th>商品链接</th>}
            <th>预估价格</th>
            <th>岛内运费</th>
            <th>价格换算</th>
            {status !== 'pending' && <th>实际价格</th>}
            <th>备注</th>
          </tr>
        </thead>
        <tbody>{rows.map((it, idx) => renderRow(it, idx))}</tbody>
      </table>
    )
  }

  if (status !== 'shipped') {
    return (
      <div className="table-wrap">
        {isAdmin && mergeableColumns.length > 0 && (
          <div className="merge-toolbar">
            <span>合并列：</span>
            {mergeableColumns.map((col) => (
              <label key={col}>
                <input
                  type="radio"
                  name="mergeCol"
                  checked={mergeColumn === col}
                  onChange={() => onSelectMergeColumn(col)}
                />
                {columnLabels[col]}
              </label>
            ))}
          </div>
        )}
        {renderTableBlock(sorted)}
      </div>
    )
  }

  // shipped: 按包裹分组显示
  const groups = {}
  const order = []
  for (const it of sorted) {
    const pid = it.package_id || '未分组'
    if (!groups[pid]) {
      groups[pid] = []
      order.push(pid)
    }
    groups[pid].push(it)
  }

  return (
    <div className="table-wrap">
      {order.map((pid) => {
        const pkg = packagesMap?.[pid]
        return (
          <div key={pid} className="package-block">
            <div className="package-header">
              <strong>包裹 {pkg?.package_no ?? '?'}</strong>
              <label>
                运单号：
                <input
                  className="cell-input"
                  disabled={!isAdmin}
                  value={pkg?.tracking_no ?? ''}
                  onChange={(e) => onUpdatePackage(pid, { tracking_no: e.target.value })}
                />
              </label>
              <label>
                总重量(kg)：
                <input
                  type="number"
                  className="cell-input"
                  disabled={!isAdmin}
                  value={pkg?.weight ?? ''}
                  onChange={(e) => onUpdatePackage(pid, { weight: Number(e.target.value) })}
                />
              </label>
              <label>
                国际运费：
                <input
                  type="number"
                  className="cell-input"
                  disabled={!isAdmin}
                  value={pkg?.intl_shipping ?? ''}
                  onChange={(e) => onUpdatePackage(pid, { intl_shipping: Number(e.target.value) })}
                />
              </label>
            </div>
            {renderTableBlock(groups[pid])}
          </div>
        )
      })}
    </div>
  )
}
