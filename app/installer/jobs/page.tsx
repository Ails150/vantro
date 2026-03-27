async function signOutFromJob(job: any) {
    const token = localStorage.getItem('vantro_installer_token')
    if (!navigator.geolocation) {
      alert('Location not available on this device')
      return
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      if (job.lat && job.lng) {
        const R = 6371000
        const dLat = (job.lat - pos.coords.latitude) * Math.PI / 180
        const dLng = (job.lng - pos.coords.longitude) * Math.PI / 180
        const a = Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(pos.coords.latitude*Math.PI/180)*Math.cos(job.lat*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2)
        const dist = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)))
        if (dist > 150) {
          alert('You are ' + dist + 'm from the job site. You must be within 150m to sign out.')
          return
        }
      }
      await fetch('/api/signout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ jobId: job.id })
      })
      setJobs(prev => prev.map((j: any) => j.id === job.id ? { ...j, signed_in: false } : j))
      setActiveJob(null)
      setGpsStatus('idle')
      setView('jobs')
    }, () => {
      alert('Could not get your location. Please enable location access to sign out.')
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })
  }