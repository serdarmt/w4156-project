const httpMocks = require('node-mocks-http');
const moment = require('moment');

const Schedule = require('../../models/Schedule').Schedule;
const ScheduleEntry = require('../../models/Schedule').ScheduleEntry;
const Facility = require('../../models/Facility');
const Employee = require('../../models/Employee');
const User = require('../../models/User');

// middleware function
const {getSchedule} = require('../../routes/schedules');

// controller functions
const {
  getAllController,
  getOneController,
  createController,
  patchController,
  deleteController,
} = require('../../controllers/scheduleController');


describe('Controller functions for /schedules', () => {
  beforeEach(() => {
    req = httpMocks.createRequest();
    res = httpMocks.createResponse();

    Schedule.find = jest.fn().mockResolvedValue([
      {
        _id: '123',
        shifts: ['some mysterious shifts'],
      },
      {
        _id: '456',
        shifts: ['some mysterious shifts'],
      },
    ]);

    User.findById = jest.fn().mockResolvedValue({
      _id: 'some_user_id',
      managedFacility: 'some_facility_id',
    });

    req.user = {_id: 'some_user_id'};
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllController', () => {
    it('should return all schedules', async () => {
      await getAllController(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toStrictEqual([
        {
          _id: '123',
          shifts: ['some mysterious shifts'],
        },
        {
          _id: '456',
          shifts: ['some mysterious shifts'],
        },
      ]);
    });

    it('should return 500 when database error', async () => {
      Schedule.find = jest.fn().mockRejectedValue(new Error('Database error'));

      await getAllController(req, res);

      expect(res.statusCode).toBe(500);
      expect(res._getJSONData()).toStrictEqual({
        message: 'Database error',
      });
    });
  });

  describe('getOneController', () => {
    it('should return schedule with id 123', async () => {
      const req = httpMocks.createRequest();
      const res = httpMocks.createResponse();

      req.params.id = '123';

      res.schedule = {
        _id: '123',
        shifts: ['some mysterious shifts'],
      };

      await getOneController(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().schedule).toStrictEqual({
        _id: '123',
        shifts: ['some mysterious shifts'],
      });
    });
  });

  describe('createController', () => {
    // before each test case, we mock the Facility model
    // by setting the return value of findOne
    beforeEach(() => {
      jest.mock('../../models/Facility');
      Facility.findOne = jest.fn().mockResolvedValue({
        _id: '123',
        facilityName: 'some facility',
        operatingHours: {
          start: '09:00',
          end: '17:00',
        },
        numberShifts: 2,
      });
    });

    it('should return 404 when facility not found', async () => {
      // mock the behavior of Facility.findOne such that it returns null
      // meaning that the facility is not found
      jest.clearAllMocks();
      jest.mock('../../models/Facility');
      Facility.findOne = jest.fn().mockResolvedValue(null);

      req.body = {
        facility: 'some non-existing facility',
      };

      await createController(req, res);

      expect(res.statusCode).toBe(404);
      expect(res._getJSONData()).toStrictEqual({
        message: 'Cannot find the facility',
        facility: 'some non-existing facility',
      });
    });

    it('should be able to create a schedule', async () => {
      req.body = {
        facility: 'some_facility_id',
      };

      // mock facility.employees
      Facility.findOne = jest.fn().mockResolvedValue({
        _id: 'some_facility_id',
        employees: ['1', '2', '3'],
        operatingHours: {
          start: '09:00',
          end: '17:00',
        },
        numberShifts: 2,
      });

      // mock Employee.findOne
      Employee.findOne = jest.fn().mockImplementation((id) => {
        return Promise.resolve({
          _id: id,
          employeeOf: 'some_facility_id',
        });
      });

      // mock schedule.save()
      Schedule.prototype.save = jest.fn().mockReturnThis();
      await createController(req, res);

      expect(res.statusCode).toBe(201);

      const newSchedule = res._getJSONData();
      const newShifts = newSchedule.shifts;

      // check that the shifts is an array of length 3
      expect(newShifts).toBeInstanceOf(Array);
      expect(newShifts.length).toBe(3);

      // operating hours is 9am to 5pm; do sanity check on the shift
      const start = moment('09:00', 'HH:mm');
      const end = moment('17:00', 'HH:mm');

      const shiftStart = moment(newShifts[0].start, 'HH:mm');
      const shiftEnd = moment(newShifts[0].end, 'HH:mm');

      expect(shiftStart.isBetween(start, end, undefined, '[]')).toBe(true);
      expect(shiftEnd.isAfter(shiftStart)).toBe(true);
    });
  });

  describe('patchController', () => {
    beforeEach(() => {
      // mock schedule
      res.schedule = {
        _id: '222',
        shifts: [
          {
            'msg': 'will be overwritten',
          },
        ],
      };

      // mock facility
      res.facility = {
        _id: '33312',
        facilityName: 'Tom\'s restaurant',
        employees: ['1', '2', '3'],
        operatingHours: {
          start: '09:00',
          end: '17:00',
        },
        numShifts: 2,
      };

      // mock .validate()
      ScheduleEntry.prototype.validate = jest.fn();
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should verify employee works at the facility', async () => {
      const req = {
        body: {
          shifts: [{
            employeeId: 'not_valid',
            start: '09:00',
            end: '18:00',
          }],
        },
      };

      res.status = jest.fn().mockReturnThis();
      res.json = jest.fn();

      await patchController(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Error: Employee does not work at the facility.',
        employeeId: 'not_valid',
      });
    });

    it('should spot invalid shifts that are out of boundary', async () => {
      const req = {
        body: {
          shifts: [{
            employeeId: '1',
            start: '09:00',
            end: '18:00',
          }],
        },
      };

      res.status = jest.fn().mockReturnThis();
      res.json = jest.fn();

      await patchController(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Error: Start/end time is out of the operating hours.',
        start: '09:00',
        end: '18:00',
      });
    });

    it('should spot invalid shifts that are not formatted correctly',
        async () => {
          const req = {
            body: {
              shifts: [{
                employeeId: '1',
                start: '19:141',
                end: '18:00',
              }],
            },
          };

          res.status = jest.fn().mockReturnThis();
          res.json = jest.fn();

          await patchController(req, res);

          expect(res.status).toHaveBeenCalledWith(400);
          expect(res.json).toHaveBeenCalledWith({
            message: 'Error: Invalid start/end time format. ' +
            'Strict parsing with format HH:mm.',
            start: '19:141',
            end: '18:00',
          });
        });

    it('should spot invalid shifts that start after end time',
        async () => {
          const req = {
            body: {
              shifts: [{
                employeeId: '1',
                start: '19:00',
                end: '18:00',
              }],
            },
          };

          res.status = jest.fn().mockReturnThis();
          res.json = jest.fn();

          await patchController(req, res);

          expect(res.status).toHaveBeenCalledWith(400);
          expect(res.json).toHaveBeenCalledWith({
            message: 'Error: Start time must be before end time.',
            start: '19:00',
            end: '18:00',
          });
        });


    it('should handle validation error', async () => {
      // mock .validate() to throw an error
      ScheduleEntry.prototype.validate = jest.fn(() => {
        throw new Error('Validation error');
      });

      const req = {
        body: {
          shifts: [{
            employeeId: '1',
            start: '09:00',
            end: '17:00',
            days: ['Invalid day'],
          }],
        },
      };

      res.status = jest.fn().mockReturnThis();
      res.json = jest.fn();

      await patchController(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Validation error',
      });
    });

    it('should handle database error', async () => {
      // mock Schedule.findOneAndUpdate to throw an error
      Schedule.findOneAndUpdate = jest.fn().mockRejectedValue(
          new Error('Database error'));

      const req = {
        body: {
          shifts: [{
            employeeId: '1',
            start: '09:00',
            end: '17:00',
            days: [],
          }],
        },
      };

      res.status = jest.fn().mockReturnThis();
      res.json = jest.fn();

      await patchController(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Database error',
      });
    });
  });

  describe('deleteController', () => {
    it('should return 500 when database error', async () => {
      res = {
        schedule: {
          deleteOne: jest.fn(() => {
            throw new Error('Database error');
          }),
        },
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      req.params.id = '000';

      await deleteController(req, res);

      expect(res.status).toBeCalledWith(500);
      expect(res.json).toBeCalledWith({
        message: 'Database error',
      });
    });

    it('should return status code 204 when schedule deleted', async () => {
      res = {
        schedule: {
          deleteOne: jest.fn(),
        },
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      req.params.id = '123';

      await deleteController(req, res);

      expect(res.status).toBeCalledWith(204);
    });
  });
});


describe('Middleware: getSchedule', () => {
  // these objects are all mocked
  let req; let res; let next;

  beforeEach(() => {
    req = httpMocks.createRequest();
    res = httpMocks.createResponse();
    next = jest.fn();

    Schedule.findById = jest.fn((id) => {
      if (id === '123') {
        // Mock that the schedule id 123 is in the database
        return Promise.resolve({
          _id: '123',
          facilityId: {
            toString: jest.fn().mockReturnValue('some_facility_id'),
          },
          shifts: ['some mysterious shifts'],
        });
      } else {
        // Return a promise that resolves with null when the ID is not '123'
        return Promise.resolve(null);
      }
    });

    User.findById = jest.fn().mockResolvedValue({
      _id: 'some_user_id',
      managedFacility: {
        toString: jest.fn().mockReturnValue('some_facility_id'),
      },
    });

    req.user = {_id: 'some_user_id'};
  });

  it('should find schedule with id 123', async () => {
    req.params.id = '123';

    await getSchedule(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.schedule).toBeDefined();
  });

  it('should not find schedule with id 456', async () => {
    // mock a request with :id = 456
    req.params.id = '456';

    await getSchedule(req, res, next);

    expect(res.schedule).toBeUndefined();
    // we expect status code 404, id not found
    expect(res.statusCode).toBe(404);
  });

  it('should forbid access when user does not manage the facility',
      async () => {
        User.findById = jest.fn().mockResolvedValue({
          _id: 'some_user_id',
          managedFacility: {
            toString: jest.fn().mockReturnValue('some_other_facility_id'),
          },
        });

        req.params.id = '123';

        await getSchedule(req, res, next);

        expect(res.statusCode).toBe(403);
        expect(res._getJSONData()).toStrictEqual({
          message: 'Forbidden to access',
        });
      });
});
