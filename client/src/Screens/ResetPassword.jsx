import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Lock, Eye, EyeOff } from 'lucide-react';
import api from '../api';
import '../App.css';

function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

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
      await api.post(`/reset-password/${token}`, { password });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2500);
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

          {!success ? (
            <>
              <p className="v3-forgot-text">Enter your new password below.</p>

              <form className="v3-form" onSubmit={handleSubmit}>
                <div className="v3-input-wrap">
                  <Lock size={16} className="v3-input-icon" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="New Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="v3-input v3-input-with-icon"
                    minLength="6"
                    maxLength="15"
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
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Confirm New Password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="v3-input v3-input-with-icon"
                    minLength="6"
                    maxLength="15"
                    required
                  />
                </div>

                {error && <p className="v3-error">{error}</p>}

                <button type="submit" className="v3-btn" disabled={loading}>
                  {loading ? 'Resetting...' : 'Reset Password'}
                </button>
              </form>
            </>
          ) : (
            <p className="v3-forgot-success">
              Password reset successfully! Redirecting to login...
            </p>
          )}

          <div className="v3-links v3-links-center">
            <Link to="/login">Back to login</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ResetPassword;