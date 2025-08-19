import request from 'supertest';
import express from 'express';
import { createTestApp } from '../setup';
import healthRoutes from '../../routes/v1/healthRoutes';

describe('Health Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    app.use('/api/v1/health', healthRoutes);
  });

  describe('GET /api/v1/health/metrics', () => {
    it('should return performance metrics', async () => {
      const response = await request(app)
        .get('/api/v1/health/metrics')
        .expect(200);

      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('system');
      expect(response.body).toHaveProperty('recent');
    });

    it('should include memory metrics', async () => {
      const response = await request(app)
        .get('/api/v1/health/metrics')
        .expect(200);

      expect(response.body.system.memory).toHaveProperty('used');
      expect(response.body.system.memory).toHaveProperty('total');
      expect(response.body.system.memory).toHaveProperty('free');
      expect(response.body.system.memory).toHaveProperty('percentage');
    });

    it('should include CPU metrics', async () => {
      const response = await request(app)
        .get('/api/v1/health/metrics')
        .expect(200);

      expect(response.body.system.cpu).toHaveProperty('usage');
      expect(response.body.system.cpu).toHaveProperty('load');
    });

    it('should include request metrics', async () => {
      const response = await request(app)
        .get('/api/v1/health/metrics')
        .expect(200);

      expect(response.body.system).toHaveProperty('requestRate');
      expect(response.body.system).toHaveProperty('errorRate');
      expect(response.body.system).toHaveProperty('activeConnections');
    });

    it('should include error metrics', async () => {
      const response = await request(app)
        .get('/api/v1/health/metrics')
        .expect(200);

      expect(response.body.system).toHaveProperty('errorRate');
    });
  });

  describe('GET /api/v1/health/cache', () => {
    it('should return cache status', async () => {
      const response = await request(app)
        .get('/api/v1/health/cache')
        .expect(200);

      expect(response.body).toHaveProperty('connected');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('stats');
    });

    it('should include cache statistics', async () => {
      const response = await request(app)
        .get('/api/v1/health/cache')
        .expect(200);

      expect(response.body.stats).toHaveProperty('hits');
      expect(response.body.stats).toHaveProperty('misses');
      expect(response.body.stats).toHaveProperty('size');
      expect(response.body.stats).toHaveProperty('keys');
    });

    it('should show cache connection status', async () => {
      const response = await request(app)
        .get('/api/v1/health/cache')
        .expect(200);

      expect(response.body).toHaveProperty('connected');
      expect(typeof response.body.connected).toBe('boolean');
    });
  });

  describe('GET /api/v1/health/live', () => {
    it('should return live status', async () => {
      const response = await request(app)
        .get('/api/v1/health/live')
        .expect(200);

      expect(response.body).toHaveProperty('alive', true);
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
    });

    it('should include uptime information', async () => {
      const response = await request(app)
        .get('/api/v1/health/live')
        .expect(200);

      expect(response.body).toHaveProperty('uptime');
      expect(typeof response.body.uptime).toBe('number');
      expect(response.body.uptime).toBeGreaterThan(0);
    });

    it('should always return alive status', async () => {
      const response = await request(app)
        .get('/api/v1/health/live')
        .expect(200);

      expect(response.body).toHaveProperty('alive', true);
    });
  });

  describe('Response Format', () => {
    it('should return consistent JSON format for working endpoints', async () => {
      const endpoints = [
        '/api/v1/health/metrics',
        '/api/v1/health/cache',
        '/api/v1/health/live'
      ];

      for (const endpoint of endpoints) {
        const response = await request(app)
          .get(endpoint)
          .expect(200);

        expect(response.headers['content-type']).toMatch(/application\/json/);
        expect(response.body).toHaveProperty('timestamp');
      }
    });

    it('should include proper HTTP headers', async () => {
      const response = await request(app)
        .get('/api/v1/health/metrics')
        .expect(200);

      expect(response.headers).toHaveProperty('content-type');
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('Load Testing', () => {
    it('should handle multiple concurrent requests', async () => {
      const requests = Array(10).fill(null).map(() =>
        request(app).get('/api/v1/health/metrics')
      );

      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('system');
      });
    });

    it('should maintain performance under load', async () => {
      const startTime = Date.now();
      
      const requests = Array(50).fill(null).map(() =>
        request(app).get('/api/v1/health/metrics')
      );

      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Should complete within 5 seconds
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid endpoints gracefully', async () => {
      const response = await request(app)
        .get('/api/v1/health/invalid')
        .expect(404);

      // 404 responses might not have an error property, just check the status
      expect(response.status).toBe(404);
    });

    it('should handle malformed requests', async () => {
      const response = await request(app)
        .post('/api/v1/health/metrics')
        .expect(404);

      // 404 responses might not have an error property, just check the status
      expect(response.status).toBe(404);
    });
  });
});
