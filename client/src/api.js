import axios from 'axios';

// Login, register, password reset
const api = axios.create({
  baseURL: '/api/auth',
});

// Anything that needs the user to be logged in (meetings, settings)
export const meetingsApi = axios.create({
  baseURL: '/api',
});

meetingsApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

meetingsApi.interceptors.response.use(
  (res) => res,
  (err) => {
    // login expired: send the user back to the login page
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;