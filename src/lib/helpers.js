// 通用工具函数：处理编号顺延、合并/拆分、金额汇总

// 数字转 Excel 风格列名前缀，例如 pending 用 a1,a2.. purchased 用 b1,b2..
export function makeLabel(prefix, index) {
  return `${prefix}${index + 1}`
}

// 按 sort_order 排序
export function sortByOrder(items) {
  return [...items].sort((a, b) => a.sort_order - b.sort_order)
}

// 将一批 items 重新编号 (sort_order = 0,1,2...)，返回需要更新的 {id, sort_order} 列表
export function renumber(items) {
  const sorted = sortByOrder(items)
  return sorted.map((it, idx) => ({ id: it.id, sort_order: idx }))
}

// 合并选中的行：把 targetIds 在 column 上的值求和，写入位置最靠前的那一行，
// 其余行该列置空，并整体重排使这些行彼此相邻（移动到最靠前那行原来的位置）。
// 返回 { updates, merge_group_id } —— updates 是需要写回数据库的字段集合（每行的部分字段）
export function computeMerge(allItems, targetIds, column) {
  const merge_group_id = crypto.randomUUID()
  const sorted = sortByOrder(allItems)
  const targetSet = new Set(targetIds)

  const merged = sorted.filter((it) => targetSet.has(it.id))
  const others = sorted.filter((it) => !targetSet.has(it.id))

  if (merged.length < 2) {
    throw new Error('至少选择两行才能合并')
  }

  const sum = merged.reduce((s, it) => s + (Number(it[column]) || 0), 0)

  // 计算插入位置：在原始顺序中，第一个被合并的行之前，"未被合并"的行有多少个
  const firstMergedOriginalIndex = sorted.findIndex((it) => it.id === merged[0].id)
  const insertAt = sorted
    .slice(0, firstMergedOriginalIndex)
    .filter((it) => !targetSet.has(it.id)).length

  const newOrder = [
    ...others.slice(0, insertAt),
    ...merged,
    ...others.slice(insertAt),
  ]

  const orderUpdates = newOrder.map((it, idx) => ({ id: it.id, sort_order: idx }))

  // 值更新：第一行（合并组里排最前的）写入总和，其余该列清空，全部打上 merge_group_id/merge_column
  const valueUpdates = merged.map((it, idx) => ({
    id: it.id,
    merge_group_id,
    merge_column: column,
    [column]: idx === 0 ? sum : null,
  }))

  return { orderUpdates, valueUpdates, merge_group_id }
}

// 拆分：清空 merge 标记，该列数值归零
export function computeSplit(targetIds, column) {
  return targetIds.map((id) => ({
    id,
    merge_group_id: null,
    merge_column: null,
    [column]: 0,
  }))
}

// 金额求和（忽略 null/undefined，但记录是否存在缺失）
export function sumColumn(items, column) {
  let sum = 0
  let hasEmpty = false
  for (const it of items) {
    const v = it[column]
    if (v === null || v === undefined || v === '') {
      hasEmpty = true
    } else {
      sum += Number(v) || 0
    }
  }
  return { sum, hasEmpty }
}

export function formatMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-'
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
