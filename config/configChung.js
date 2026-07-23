const configChung = {
  standard: {
    configMenu: {
      //Trang chủ
      'trangChu': true,
      //Thông tin quản lý
      'ttqlToChuc': true,
      'ttqlKhoiLuong': true,
      //Hồ sơ thiết kế thi công nghiệm thu
      'hoSoThietKeThiCongNghiemThu': false,
      //Giao nhận công việc
      'gncvKiemTra': true,
      'gncvSuaChuaBaoDuong': false,
      'gncvDoThongSo': false,
      'gncvPhuTro': false,
      'gncvCongViecCuaToi': true,
      'gncvPhieuMau': false,
      //Quản lý vận hành
      'qlvhDanhSachTonTai': false,
      'qlvhThongKeCongViec': false,
      'qlvhHoSoVanHanh': false,
      'qlvhNangSuatLamViec': false,
      'qlvhQuanLyCongViec': false,
      'qlvhTonTaiCapTren': false,
      'qlvhSuCoDuongDay': false,
      //Tổng kê
      'tkCongTrinh': true,
      'tkDuongDay': true,
      'tkKhoangCot': true,
      'tkViTri': true,
      //Cập nhật và rà soát dữ liệu
      'cnrsdlNhapViTri': true,
      'cnrsdlNhapCongTrinh': true,
      'cnrsdlNhapDuongDay': true,
      'cnrsdlRaSoatViTri': true,
      'cnrsdlRaSoatKhoangCot': true,
      //Người dùng
      'ndDanhSachNguoiDung': true,
      'ndKhoiPhucTaiKhoan': true,
      'ndVaiTro': true,
      //Quản lý thiết bị dụng cụ
      'qltbdcTheoDoiThietBiThiCong': true,
      'qltbdcQuanLyThietBiCongNghe': true,
      'qltbdcQuanLyThietBiDo': true,
      //Danh mục chung
      'dmcThietBi': true,
      'dmcDiaHinh': true,
      'dmcChuyenDe': true,
      'dmcNoiDungKiemTra': true,
      'dmcCongViecSuaChua': true,
      'dmcCongViecPhuTro': true,
      'dmcDieuKienAnToan': true,
      'dmcBienPhapAnToan': true,
      'dmcCapDienAp': true,
      'dmcHoSoQuanLyVanHanh': true,
      'dmcHoSoThietBi': true,
      'dmcNhomThietBiThiCong': true,
      'dmcThietBiCongNghe': true,
      'dmcThietBiDo': true,
      //Cài đặt hệ thống
      'caiDatHeThong': true,
    },
    configChucNang: {
      //TODO
    },
    configToaDo: { minLat: '8.380852', minLng: '104.8312831', maxLat: '23.392505', maxLng: '114.680778' },
    //EVNNPT|| EVNNPC|| EVNGLB
    configSite: 'EVNNPC',
  },
  pro: {
    configMenu: {
      //Trang chủ
      'trangChu': true,
      //Thông tin quản lý
      'ttqlToChuc': true,
      'ttqlKhoiLuong': true,
      //Hồ sơ thiết kế thi công nghiệm thu
      'hoSoThietKeThiCongNghiemThu': true,
      //Giao nhận công việc
      'gncvKiemTra': true,
      'gncvSuaChuaBaoDuong': true,
      'gncvDoThongSo': true,
      'gncvPhuTro': true,
      'gncvCongViecCuaToi': true,
      'gncvPhieuMau': true,
      //Quản lý vận hành
      'qlvhDanhSachTonTai': true,
      'qlvhThongKeCongViec': true,
      'qlvhHoSoVanHanh': true,
      'qlvhNangSuatLamViec': true,
      'qlvhQuanLyCongViec': true,
      'qlvhTonTaiCapTren': true,
      'qlvhSuCoDuongDay': true,
      //Tổng kê
      'tkCongTrinh': true,
      'tkDuongDay': true,
      'tkKhoangCot': true,
      'tkViTri': true,
      //Cập nhật và rà soát dữ liệu
      'cnrsdlNhapViTri': true,
      'cnrsdlNhapCongTrinh': true,
      'cnrsdlNhapDuongDay': true,
      'cnrsdlRaSoatViTri': true,
      'cnrsdlRaSoatKhoangCot': true,
      //Người dùng
      'ndDanhSachNguoiDung': true,
      'ndKhoiPhucTaiKhoan': true,
      'ndVaiTro': true,
      //Quản lý thiết bị dụng cụ
      'qltbdcTheoDoiThietBiThiCong': true,
      'qltbdcQuanLyThietBiCongNghe': true,
      'qltbdcQuanLyThietBiDo': true,
      //Danh mục chung
      'dmcThietBi': true,
      'dmcDiaHinh': true,
      'dmcChuyenDe': true,
      'dmcNoiDungKiemTra': true,
      'dmcCongViecSuaChua': true,
      'dmcCongViecPhuTro': true,
      'dmcDieuKienAnToan': true,
      'dmcBienPhapAnToan': true,
      'dmcCapDienAp': true,
      'dmcHoSoQuanLyVanHanh': true,
      'dmcHoSoThietBi': true,
      'dmcNhomThietBiThiCong': true,
      'dmcThietBiCongNghe': true,
      'dmcThietBiDo': true,
      //Cài đặt hệ thống
      'caiDatHeThong': true,
    },
    configChucNang: {
      //TODO
    },
    configToaDo: { minLat: '8.380852', minLng: '104.8312831', maxLat: '23.392505', maxLng: '114.680778' },
    //EVNNPT|| EVNNPC|| EVNGLB
    configSite: 'EVNNPT',
  },
};

// export const getMenuConfig = configChung.standard;
export const getMenuConfig = configChung.pro;