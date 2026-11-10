// HDL-9: combinational loops — an SR latch of two NANDs (it settles), a ring of three inverters
// gated by en and a multiplexer feeding back its own inverse (neither settles while en is 1).
module loops (input s_n, input r_n, input en, output q, output q_n, output ring, output toggle);
  assign q = ~(s_n & q_n);
  assign q_n = ~(r_n & q);
  wire r1, r2, r3;
  assign r1 = ~(r3 & en);
  assign r2 = ~r1;
  assign r3 = ~r2;
  assign ring = r3;
  assign toggle = en ? ~toggle : toggle;
endmodule
