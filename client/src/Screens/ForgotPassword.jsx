import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import api from '../api';
import '../App.css';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/forgot-password', { email });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setIsSubmitted(true);
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

          {!isSubmitted ? (
            <>
              <p className="v3-forgot-text">
                Enter your email and we'll send you a link to reset your
                password.
              </p>

              <form className="v3-form" onSubmit={handleSubmit}>
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

                <button type="submit" className="v3-btn" disabled={loading}>
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>
            </>
          ) : (
            <p className="v3-forgot-success">
              If an account exists for <strong>{email}</strong>, a reset
              link has been sent.
            </p>
          )}

          <div className="v3-links v3-links-center">
            <Link to="/login">
              <ArrowLeft size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;