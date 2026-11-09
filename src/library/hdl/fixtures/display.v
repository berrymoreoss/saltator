// $display in an always block: a $print cell, ignored with a warning.
module display (input clk, input d, output reg q);
  always @(posedge clk) begin
    q <= d;
    $display("d=%b", d);
  end
endmodule
