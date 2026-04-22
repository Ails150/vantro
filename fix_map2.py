content = open('components/admin/AdminDashboard.tsx', encoding='utf-8').read()
content = content.replace(
    '{ id: "audit", label: "Audit" },',
    '{ id: "audit", label: "Audit" },\n    { id: "map", label: "Map" },'
)
content = content.replace(
    "import MapTab from './MapTab'",
    "import MapTab from './MapTab'"
)
# Add map tab render if not already there
if 'activeTab === "map"' not in content:
    content = content.replace(
        '{activeTab === "audit" && <AuditTab />}',
        '{activeTab === "audit" && <AuditTab />}\n          {activeTab === "map" && <MapTab />}'
    )
open('components/admin/AdminDashboard.tsx', 'w', encoding='utf-8').write(content)
print('Map tab added:', '{ id: "map"' in content)