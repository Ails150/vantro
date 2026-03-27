const fs = require("fs")
let c = fs.readFileSync("C:/vantro/app/api/checklist/route.ts", "utf8")

c = c.replace(
  `  if (action === 'delete_item') {
    const { itemId } = body
    await service.from('checklist_items').delete().eq('id', itemId)
    return NextResponse.json({ success: true })
  }`,
  `  if (action === 'delete_item') {
    const { itemId } = body
    console.log('Deleting item:', itemId)
    const { error, count } = await service.from('checklist_items').delete({ count: 'exact' }).eq('id', itemId)
    console.log('Delete result:', { error, count })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, deleted: count })
  }`
)

fs.writeFileSync("C:/vantro/app/api/checklist/route.ts", c, "utf8")
console.log("Done")
