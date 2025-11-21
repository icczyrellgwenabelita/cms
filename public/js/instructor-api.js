// Shared utility for instructor API calls
const instructorAPI = {
  getToken() {
    return localStorage.getItem('instructorToken');
  },

  async request(endpoint, options = {}) {
    const token = this.getToken();
    if (!token) {
      window.location.href = '/caresim-login';
      throw new Error('No token found');
    }

    const response = await fetch(`/api/instructor${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers
      }
    });

    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem('instructorToken');
      window.location.href = '/caresim-login';
      throw new Error('Unauthorized');
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    // Log response for debugging
    console.log(`Instructor API ${options.method || 'GET'} ${endpoint}:`, data);
    
    return data;
  },

  async get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  async post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  async put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  },

  async delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
};


