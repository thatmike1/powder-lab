import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import World3D from './world3d/World3D'

const root = document.getElementById('root')
if (!root) throw new Error('root element #root not found')
// "?3d" mounts the first-person 3d prototype; everything else is the normal app.
const is3D = new URLSearchParams(location.search).has('3d')
ReactDOM.createRoot(root).render(is3D ? <World3D /> : <App />)
