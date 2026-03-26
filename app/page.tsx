import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/signup')
}
```

Save, then:
```
git add .
git commit -m "fix page.tsx"
git push origin master