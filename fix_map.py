content = open('components/admin/AdminDashboard.tsx', encoding='utf-8').read()

# Add MapTab import
content = content.replace(
    "import AuditTab from './AuditTab'",
    "import AuditTab from './AuditTab'\nimport MapTab from './MapTab'"
)

# Add Map tab to tabs list
content = content.replace(
    "'Checklists', 'Audit', 'Jobs'",
    "'Checklists', 'Audit', 'Map', 'Jobs'"
)

# Add Map tab render
content = content.replace(
    "{activeTab === 'Audit' && <AuditTab />}",
    "{activeTab === 'Audit' && <AuditTab />}\n          {activeTab === 'Map' && <MapTab />}"
)

open('components/admin/AdminDashboard.tsx', 'w', encoding='utf-8').write(content)
print('Map tab wired:', 'MapTab' in content)