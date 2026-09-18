import axios from 'axios';

const api = axios.create({
  baseURL: '/api/auth', 
});

export default api;