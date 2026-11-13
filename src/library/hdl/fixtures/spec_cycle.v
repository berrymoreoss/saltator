// A cycle-time check (feat/hdl-timing): Yosys reads no `$period`, so a clock's cycle is a `$hold`
// between one pin's same edges — here armed only while counting (`&&&`).
module spec_cycle (
    input            clk,
    input            rst,
    input            en,
    output reg [1:0] q
);
  always @(posedge clk)
    if (rst) q <= 2'd0;
    else if (en) q <= q + 2'd1;
  specify
    (posedge clk *> (q +: q)) = 5;
    $hold(posedge clk &&& en, posedge clk, 50);
  endspecify
endmodule
