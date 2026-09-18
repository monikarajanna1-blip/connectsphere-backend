import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User, Eye, EyeOff } from 'lucide-react';
import api from '../api';
import '../App.css';

function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

    const handleRegister = async (e) => {
    e.preventDefault();
    setError('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    if (password.length < 6 || password.length > 15) {
      setError('Password must be between 6 and 15 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/register', { name, email, password });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      navigate('/home');
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="v3-container">
      <div className="v3-ring">
        <div className="v3-card">
          <div className="v3-logo">
            Connect<span>Sphere</span>
          </div>
          <div className="v3-tagline">Meet · Include · Empower</div>

          <form className="v3-form" onSubmit={handleRegister}>
            <div className="v3-input-wrap">
              <User size={16} className="v3-input-icon" />
              <input
                type="text"
                placeholder="Full Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="v3-input v3-input-with-icon"
                required
              />
            </div>

            <div className="v3-input-wrap">
              <Mail size={16} className="v3-input-icon" />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="v3-input v3-input-with-icon"
                required
              />
            </div>

            <div className="v3-input-wrap">
              <Lock size={16} className="v3-input-icon" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="v3-input v3-input-with-icon"
                minLength="6"  maxLength="15"
                required
              />
              <button
                type="button"
                className="v3-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <div className="v3-input-wrap">
              <Lock size={16} className="v3-input-icon" />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="v3-input v3-input-with-icon"
                required
              />
              <button
                type="button"
                className="v3-eye-btn"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {error && <p className="v3-error">{error}</p>}

            <button type="submit" className="v3-btn" disabled={loading}>
              {loading ? 'Creating account...' : 'Sign Up'}
            </button>
          </form>

          <div className="v3-links">
            <Link to="/login">Already have an account?</Link>
            <span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Register;