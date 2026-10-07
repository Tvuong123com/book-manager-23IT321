import session from 'express-session';

function getExpiry(data) {
  return data.cookie?.expires
    ? new Date(data.cookie.expires)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);
}

export class AtlasSessionStore extends session.Store {
  constructor(readSessions, writeSessions) {
    super();
    this.readSessions = readSessions;
    this.writeSessions = writeSessions;
  }

  // Đọc phiên: chỉ dùng tài khoản reader.
  get(sid, callback) {
    this.readSessions
      .findOne({
        _id: sid,
        expires: { $gt: new Date() }
      })
      .then((doc) => {
        callback(null, doc ? JSON.parse(doc.data) : null);
      })
      .catch(callback);
  }

  // Tạo/cập nhật phiên: chỉ dùng tài khoản writer.
  set(sid, data, callback) {
    this.writeSessions
      .updateOne(
        { _id: sid },
        {
          $set: {
            data: JSON.stringify(data),
            expires: getExpiry(data)
          }
        },
        { upsert: true }
      )
      .then(() => callback())
      .catch(callback);
  }

  // Gia hạn phiên khi người dùng tiếp tục truy cập.
  touch(sid, data, callback) {
    this.writeSessions
      .updateOne(
        { _id: sid },
        { $set: { expires: getExpiry(data) } }
      )
      .then(() => callback())
      .catch(callback);
  }

  // Xóa phiên khi đăng xuất.
  destroy(sid, callback) {
    this.writeSessions
      .deleteOne({ _id: sid })
      .then(() => callback())
      .catch(callback);
  }
}