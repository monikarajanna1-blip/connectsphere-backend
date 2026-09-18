import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/connectsphere_logo.png';
import '../App.css';

function Splash() {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate('/login');
    }, 2500);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="splash-container">
      <img src={logo} alt="ConnectSphere" className="splash-logo" />
    </div>
  );
}

export default Splash;