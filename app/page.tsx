import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/signup')
}
```

Save, then push:
```
git add .
git commit -m "root redirect"
git push origin master