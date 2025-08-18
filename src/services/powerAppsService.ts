import axios, { AxiosError } from 'axios';

import { loggerService } from '../utils/logger';

class PowerAppsService {
  private static powerAppsEndpoint: string = process.env.POWERAPPS_PAGEPROOF_PAGEAPPROVED || '';

  // Send data to PowerApps endpoint
  public static async sendToPowerApps(eventData: any): Promise<void> {
    if (!PowerAppsService.powerAppsEndpoint) {
      loggerService.logger.error('PowerApps endpoint is not defined.');
      return;
    }

    try {
      const response = await axios.post(PowerAppsService.powerAppsEndpoint, eventData, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      loggerService.logger.info('Successfully sent to PowerApps:', response.data);
    } catch (error) {
      PowerAppsService.handleError(error);
    }
  }

  // Handle error when sending data to PowerApps
  private static handleError(error: unknown): void {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      loggerService.logger.error(
        'Axios error while sending to PowerApps:',
        axiosError.response?.data || axiosError.message,
      );
    } else {
      loggerService.logger.error('Unexpected error while sending to PowerApps:', error);
    }
  }
}

export { PowerAppsService };
