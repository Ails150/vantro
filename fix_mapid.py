content = open('components/admin/MapTab.tsx', encoding='utf-8').read()
content = content.replace(
    'const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || ""',
    'const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || ""\nconst GOOGLE_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || ""'
)
content = content.replace(
    'mapId="vantro-map"',
    'mapId={GOOGLE_MAP_ID}'
)
open('components/admin/MapTab.tsx', 'w', encoding='utf-8').write(content)
print('Map ID wired:', 'GOOGLE_MAP_ID' in content)