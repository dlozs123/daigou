import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from './supabaseClient'
import Login from './Login'
import ItemsTable from './components/ItemsTable'
import Lightbox from './components/Lightbox'
import {
  computeMerge,
  computeSplit,
  sumColumn,
  formatMoney,
  renumber,
} from './lib/helpers'

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loadingAuth, setLoadingAuth] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoadingAuth(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      return
    }
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data))
  }, [session])

  if (loadingAuth) return <div className="center-msg">加载中...</div>
  if (!session) return <Login />
  if (!profile) return <div className="center-msg">加载账户信息中...</div>

  return <MainApp session={session} profile={profile} />
}

function MainApp({ session, profile }) {
  const isAdmin = profile.role === 'admin'
  const [users, setUsers] = useState([])
  const [selectedUserId, setSelectedUserId] = useState(isAdmin ? null : session.user.id)
  const [tab, setTab] = useState('pending') // pending | purchased | shipped | history
  const [batch, setBatch] = useState(null)
  const [items, setItems] = useState([])
  const [packages, setPackages] = useState([])
  const [historyBatches, setHistoryBatches] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [mergeColumn, setMergeColumn] = useState(null)
  const [lightboxUrl, setLightboxUrl] = useState(null)

  // 管理员：拉取所有普通用户列表
  useEffect(() => {
    if (!isAdmin) return
    supabase
      .from('profiles')
      .select('*')
      .eq('role', 'user')
      .then(({ data }) => {
        setUsers(data || [])
        if (data && data.length > 0 && !selectedUserId) setSelectedUserId(data[0].id)
      })
  }, [isAdmin])

  // 加载/创建当前批次
  const loadCurrentBatch = useCallback(async () => {
    if (!selectedUserId) return
    let { data: existing } = await supabase
      .from('batches')
      .select('*')
      .eq('user_id', selectedUserId)
      .eq('is_current', true)
      .maybeSingle()

    if (!existing && isAdmin) {
      const { data: created } = await supabase
        .from('batches')
        .insert({ user_id: selectedUserId, is_current: true })
        .select()
        .single()
      existing = created
    }
    setBatch(existing || null)
  }, [selectedUserId, isAdmin])

  useEffect(() => {
    loadCurrentBatch()
  }, [loadCurrentBatch])

  // 加载条目 & 包裹
  const loadItemsAndPackages = useCallback(async () => {
    if (!batch) {
      setItems([])
      setPackages([])
      return
    }
    const { data: itemData } = await supabase
      .from('items')
      .select('*')
      .eq('batch_id', batch.id)
      .order('sort_order')
    setItems(itemData || [])

    const { data: pkgData } = await supabase
      .from('packages')
      .select('*')
      .eq('batch_id', batch.id)
      .order('package_no')
    setPackages(pkgData || [])
  }, [batch])

  useEffect(() => {
    loadItemsAndPackages()
  }, [loadItemsAndPackages])

  // 历史归档批次
  useEffect(() => {
    if (tab !== 'history' || !selectedUserId) return
    supabase
      .from('batches')
      .select('*')
      .eq('user_id', selectedUserId)
      .eq('is_current', false)
      .order('archived_at', { ascending: false })
      .then(({ data }) => setHistoryBatches(data || []))
  }, [tab, selectedUserId])

  // 切 tab / 切用户时清空选择
  useEffect(() => {
    setSelectedIds([])
    setMergeColumn(null)
  }, [tab, selectedUserId])

  const pendingItems = useMemo(() => items.filter((i) => i.status === 'pending'), [items])
  const purchasedItems = useMemo(() => items.filter((i) => i.status === 'purchased'), [items])
  const shippedItems = useMemo(() => items.filter((i) => i.status === 'shipped'), [items])
  const packagesMap = useMemo(() => Object.fromEntries(packages.map((p) => [p.id, p])), [packages])

  async function updateItem(id, fields) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...fields } : it)))
    await supabase.from('items').update(fields).eq('id', id)
  }

  async function updatePackage(id, fields) {
    setPackages((prev) => prev.map((p) => (p.id === id ? { ...p, ...fields } : p)))
    await supabase.from('packages').update(fields).eq('id', id)
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function applyOrderUpdates(orderUpdates) {
    for (const u of orderUpdates) {
      await supabase.from('items').update({ sort_order: u.sort_order }).eq('id', u.id)
    }
  }

  async function handleAddRow() {
    const maxOrder = pendingItems.reduce((m, it) => Math.max(m, it.sort_order), -1)
    const { data } = await supabase
      .from('items')
      .insert({
        batch_id: batch.id,
        user_id: selectedUserId,
        status: 'pending',
        sort_order: maxOrder + 1,
      })
      .select()
      .single()
    setItems((prev) => [...prev, data])
  }

  async function handleDelete(currentTabItems) {
    if (selectedIds.length === 0) return
    if (!confirm(`确认删除选中的 ${selectedIds.length} 行？`)) return
    await supabase.from('items').delete().in('id', selectedIds)
    const remaining = currentTabItems.filter((it) => !selectedIds.includes(it.id))
    const orderUpdates = renumber(remaining)
    await applyOrderUpdates(orderUpdates)
    setSelectedIds([])
    await loadItemsAndPackages()
  }

  async function handleMerge(currentTabItems) {
    if (!mergeColumn) {
      alert('请先选择要合并的列')
      return
    }
    try {
      const { orderUpdates, valueUpdates } = computeMerge(currentTabItems, selectedIds, mergeColumn)
      for (const u of orderUpdates) {
        await supabase.from('items').update({ sort_order: u.sort_order }).eq('id', u.id)
      }
      for (const u of valueUpdates) {
        const { id, ...fields } = u
        await supabase.from('items').update(fields).eq('id', id)
      }
      setSelectedIds([])
      await loadItemsAndPackages()
    } catch (e) {
      alert(e.message)
    }
  }

  async function handleSplit() {
    const targetGroupIds = new Set()
    const groupItems = items.filter((it) => selectedIds.includes(it.id) && it.merge_group_id)
    if (groupItems.length === 0) {
      alert('请选择已合并的行')
      return
    }
    const column = groupItems[0].merge_column
    // 拆分整组（找出该 merge_group_id 下所有行）
    const groupId = groupItems[0].merge_group_id
    const allInGroup = items.filter((it) => it.merge_group_id === groupId)
    const updates = computeSplit(
      allInGroup.map((it) => it.id),
      column
    )
    for (const u of updates) {
      const { id, ...fields } = u
      await supabase.from('items').update(fields).eq('id', id)
    }
    setSelectedIds([])
    await loadItemsAndPackages()
  }

  async function handlePurchase() {
    if (selectedIds.length === 0) return
    const maxOrder = purchasedItems.reduce((m, it) => Math.max(m, it.sort_order), -1)
    let offset = 1
    for (const id of selectedIds) {
      await supabase
        .from('items')
        .update({ status: 'purchased', sort_order: maxOrder + offset })
        .eq('id', id)
      offset++
    }
    const remainingPending = pendingItems.filter((it) => !selectedIds.includes(it.id))
    await applyOrderUpdates(renumber(remainingPending))
    setSelectedIds([])
    await loadItemsAndPackages()
  }

  async function handleSend(existingPackageId = null) {
    const rowsToSend = purchasedItems.filter((it) => selectedIds.includes(it.id))
    if (rowsToSend.length === 0) return
    const incomplete = rowsToSend.some((it) => it.actual_price === null || it.actual_price === undefined)
    if (incomplete) {
      alert('只有填写了实际价格的行才能发送')
      return
    }
    let packageId = existingPackageId
    if (!packageId) {
      const nextNo = packages.reduce((m, p) => Math.max(m, p.package_no), 0) + 1
      const { data: pkg } = await supabase
        .from('packages')
        .insert({ batch_id: batch.id, package_no: nextNo })
        .select()
        .single()
      packageId = pkg.id
    }
    const maxOrder = shippedItems.reduce((m, it) => Math.max(m, it.sort_order), -1)
    let offset = 1
    for (const it of rowsToSend) {
      await supabase
        .from('items')
        .update({ status: 'shipped', package_id: packageId, sort_order: maxOrder + offset })
        .eq('id', it.id)
      offset++
    }
    const remainingPurchased = purchasedItems.filter((it) => !selectedIds.includes(it.id))
    await applyOrderUpdates(renumber(remainingPurchased))
    setSelectedIds([])
    await loadItemsAndPackages()
  }

  async function handleArchive() {
    if (pendingItems.length > 0 || purchasedItems.length > 0) {
      alert('待购买和已购买页面必须清空后才能归档')
      return
    }
    if (!confirm('确认归档本轮代购？归档后将开启新的一轮。')) return
    await supabase
      .from('batches')
      .update({ archived_at: new Date().toISOString(), is_current: false })
      .eq('id', batch.id)
    await supabase.from('batches').insert({ user_id: selectedUserId, is_current: true })
    await loadCurrentBatch()
  }

  // ---- 汇总计算 ----
  const purchasedSum = sumColumn(purchasedItems, 'actual_price')
  const pendingConvertedSum = sumColumn(pendingItems, 'price_converted')
  const predictedTotal = purchasedSum.sum + pendingConvertedSum.sum

  const shippedActualSum = sumColumn(shippedItems, 'actual_price')
  const shippedIntlSum = sumColumn(packages, 'intl_shipping')
  const domestic = batch?.domestic_shipping ?? 0
  const paid = batch?.paid_amount ?? 0
  const remainingBalance = shippedActualSum.sum + shippedIntlSum.sum + Number(domestic) - Number(paid)

  async function updateBatchField(field, value) {
    await supabase.from('batches').update({ [field]: value }).eq('id', batch.id)
    setBatch((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div>
          <strong>{isAdmin ? '管理员视图' : profile.display_name || session.user.email}</strong>
          {isAdmin && (
            <select value={selectedUserId ?? ''} onChange={(e) => setSelectedUserId(e.target.value)}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name || u.id}
                </option>
              ))}
            </select>
          )}
        </div>
        {batch && (
          <div className="batch-meta">
            <span>建立时间：{new Date(batch.created_at).toLocaleString()}</span>
            <span>最后修改：{new Date(batch.last_modified_at).toLocaleString()}</span>
            {batch.archived_at && <span>归档时间：{new Date(batch.archived_at).toLocaleString()}</span>}
          </div>
        )}
        <button className="logout-btn" onClick={() => supabase.auth.signOut()}>
          退出登录
        </button>
      </header>

      <nav className="tab-bar">
        <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>
          待购买
        </button>
        <button className={tab === 'purchased' ? 'active' : ''} onClick={() => setTab('purchased')}>
          已购买
        </button>
        <button className={tab === 'shipped' ? 'active' : ''} onClick={() => setTab('shipped')}>
          已发送
        </button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          历史记录
        </button>
      </nav>

      <main className="tab-content">
        {tab === 'pending' && (
          <>
            {isAdmin && (
              <div className="action-bar">
                <button onClick={handleAddRow}>+ 添加商品</button>
                <button onClick={() => handleDelete(pendingItems)} disabled={selectedIds.length === 0}>
                  删除选中行
                </button>
                <button onClick={() => handleMerge(pendingItems)} disabled={selectedIds.length < 2}>
                  合并选中行
                </button>
                <button onClick={handleSplit}>拆分</button>
                <button onClick={handlePurchase} disabled={selectedIds.length === 0}>
                  标记为已购买 →
                </button>
              </div>
            )}
            <ItemsTable
              items={pendingItems}
              status="pending"
              role={profile.role}
              labelPrefix="a"
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onSelectMergeColumn={setMergeColumn}
              mergeColumn={mergeColumn}
              onUpdateItem={updateItem}
              onOpenLightbox={setLightboxUrl}
            />
          </>
        )}

        {tab === 'purchased' && (
          <>
            {isAdmin && (
              <div className="action-bar">
                <button onClick={() => handleDelete(purchasedItems)} disabled={selectedIds.length === 0}>
                  删除选中行
                </button>
                <button onClick={() => handleMerge(purchasedItems)} disabled={selectedIds.length < 2}>
                  合并选中行
                </button>
                <button onClick={handleSplit}>拆分</button>
                <button onClick={() => handleSend(null)} disabled={selectedIds.length === 0}>
                  发送（新建包裹）→
                </button>
                {packages.length > 0 && (
                  <select onChange={(e) => e.target.value && handleSend(e.target.value)} defaultValue="">
                    <option value="">补充发送到已有包裹...</option>
                    {packages.map((p) => (
                      <option key={p.id} value={p.id}>
                        包裹 {p.package_no}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <ItemsTable
              items={purchasedItems}
              status="purchased"
              role={profile.role}
              labelPrefix="b"
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onSelectMergeColumn={setMergeColumn}
              mergeColumn={mergeColumn}
              onUpdateItem={updateItem}
              onOpenLightbox={setLightboxUrl}
            />
            <div className="summary-bar">
              <span>当前已付：¥{formatMoney(purchasedSum.sum)}</span>
              <span>剩余预估：¥{formatMoney(pendingConvertedSum.sum)}</span>
              <span>预计总价：¥{formatMoney(predictedTotal)}</span>
              {(purchasedSum.hasEmpty || pendingConvertedSum.hasEmpty) && (
                <span className="warning-text">当前价格不完整</span>
              )}
            </div>
          </>
        )}

        {tab === 'shipped' && (
          <>
            <ItemsTable
              items={shippedItems}
              status="shipped"
              role={profile.role}
              labelPrefix="c"
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onUpdateItem={updateItem}
              onOpenLightbox={setLightboxUrl}
              packagesMap={packagesMap}
              onUpdatePackage={updatePackage}
            />
            <div className="summary-bar">
              <span>总价：¥{formatMoney(shippedActualSum.sum)}</span>
              <span>总运费：¥{formatMoney(shippedIntlSum.sum)}</span>
              {isAdmin ? (
                <label>
                  国内运费：
                  <input
                    type="number"
                    className="cell-input"
                    value={batch?.domestic_shipping ?? ''}
                    onChange={(e) => updateBatchField('domestic_shipping', Number(e.target.value))}
                  />
                </label>
              ) : (
                <span>国内运费：¥{formatMoney(batch?.domestic_shipping)}</span>
              )}
              {isAdmin ? (
                <label>
                  已支付：
                  <input
                    type="number"
                    className="cell-input"
                    value={batch?.paid_amount ?? ''}
                    onChange={(e) => updateBatchField('paid_amount', Number(e.target.value))}
                  />
                </label>
              ) : (
                <span>已支付：¥{formatMoney(batch?.paid_amount)}</span>
              )}
              <span>剩余尾款：¥{formatMoney(remainingBalance)}</span>
              {(shippedActualSum.hasEmpty || shippedIntlSum.hasEmpty) && (
                <span className="warning-text">当前价格不完整</span>
              )}
            </div>
            {isAdmin && (
              <div className="action-bar">
                <button
                  onClick={handleArchive}
                  disabled={pendingItems.length > 0 || purchasedItems.length > 0}
                >
                  归档本轮代购
                </button>
              </div>
            )}
          </>
        )}

        {tab === 'history' && (
          <div className="history-list">
            {historyBatches.length === 0 && <p>暂无历史记录</p>}
            {historyBatches.map((b) => (
              <HistoryBatchCard key={b.id} batch={b} />
            ))}
          </div>
        )}
      </main>

      <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
    </div>
  )
}

function HistoryBatchCard({ batch }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [packages, setPackages] = useState([])

  async function toggle() {
    if (!open) {
      const { data: itemData } = await supabase.from('items').select('*').eq('batch_id', batch.id)
      const { data: pkgData } = await supabase.from('packages').select('*').eq('batch_id', batch.id)
      setItems(itemData || [])
      setPackages(pkgData || [])
    }
    setOpen(!open)
  }

  return (
    <div className="history-card">
      <div className="history-header" onClick={toggle}>
        <span>归档于 {new Date(batch.archived_at).toLocaleString()}</span>
        <span>{open ? '收起 ▲' : '展开 ▼'}</span>
      </div>
      {open && (
        <ItemsTable
          items={items}
          status="shipped"
          role="user"
          labelPrefix="c"
          selectedIds={[]}
          onToggleSelect={() => {}}
          onUpdateItem={() => {}}
          onOpenLightbox={() => {}}
          packagesMap={Object.fromEntries(packages.map((p) => [p.id, p]))}
          onUpdatePackage={() => {}}
        />
      )}
    </div>
  )
}
