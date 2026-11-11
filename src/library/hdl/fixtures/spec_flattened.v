// A chip written as its sections (HDL-2): a NAND gate with its `specify`, placed twice, keeps its
// paths on the top's ports after `flatten`; two inverters chained through an inner wire leave
// paths that end or start inside the module.
module spec_nand2 (
    input a,
    input b,
    output y
);
  assign y = ~(a & b);
  specify
    (a => y) = 9;
    (b => y) = 9;
  endspecify
endmodule

module spec_inv (
    input a,
    output y
);
  assign y = ~a;
  specify
    (a => y) = 5;
  endspecify
endmodule

module spec_flattened (
    input [1:0] a,
    input [1:0] b,
    input c,
    output [1:0] y,
    output z
);
  wire w;
  spec_nand2 u0 (
      a[0],
      b[0],
      y[0]
  );
  spec_nand2 u1 (
      a[1],
      b[1],
      y[1]
  );
  spec_inv u2 (
      c,
      w
  );
  spec_inv u3 (
      w,
      z
  );
endmodule
